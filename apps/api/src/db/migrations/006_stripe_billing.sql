-- ===========================================================================
-- Stripe: the columns that tie their records to ours
-- ===========================================================================
--
-- Applied ahead of the integration going live. Every column is nullable, so a
-- deployment without Stripe credentials behaves exactly as before and the
-- manual flow in modules/billing/service.ts keeps working untouched.
--
-- The ids are stored in their own columns rather than reusing `external_ref`.
-- `external_ref` is already the reference the manual checkout flow matches its
-- webhook against; overloading it would make a provider who once used the
-- manual flow and later moved to Stripe ambiguous.
-- ===========================================================================

/* -------------------------------- customer -------------------------------- */

-- One Stripe customer per provider, kept for the lifetime of the account so a
-- provider who cancels and returns keeps their payment methods and history.
ALTER TABLE providers ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS providers_stripe_customer_uniq
  ON providers (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

/* ------------------------------ subscription ------------------------------ */

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- Unique: two of our rows pointing at one Stripe subscription would make the
-- webhook handler's update ambiguous, and it is the handler that decides
-- whether somebody is visible in search.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_uniq
  ON subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Stripe's own status, stored verbatim alongside our translation of it.
-- When the two disagree the raw value is what makes the disagreement
-- diagnosable; without it the only record of what Stripe said is a log line.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_status text;

/* --------------------------------- plans ---------------------------------- */

-- The Stripe Price a plan sells. Prices are immutable in Stripe: changing what
-- a plan costs means creating a new price and pointing this column at it,
-- which leaves existing subscribers on the old one until they move.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS stripe_price_id text;

CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_stripe_price_uniq
  ON subscription_plans (stripe_price_id) WHERE stripe_price_id IS NOT NULL;

/* -------------------------------- payments -------------------------------- */

-- Stripe hosts a receipt for every invoice it settles. Storing the link means
-- a provider can produce proof of what they paid the platform, which the
-- platform does not otherwise issue.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_invoice_url text;

/* ----------------------------- webhook events ----------------------------- */

-- Stripe events are recorded under their own source so they dedupe separately
-- from the manual billing webhook and can be told apart when reading the table.
ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS webhook_events_source_check;
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_source_check
  CHECK (source IN ('billing','whatsapp','stripe'));
