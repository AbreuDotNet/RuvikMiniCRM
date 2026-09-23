-- Plan entitlements.
--
-- Until now a plan carried two numbers — listings and quotes — and only the
-- first was ever checked. The commercial plans are built on a different axis:
-- how many clients you keep, how many receipts you issue, whether you can
-- export a tax report, and whether anyone else can log in beside you. This
-- adds those, and gives every capability one name the whole codebase uses.
--
-- Two shapes, on purpose:
--
--   * Quotas are integer columns, because they are compared (`>= limit`) and a
--     NULL means unlimited — a meaning a JSON blob cannot carry without every
--     reader inventing its own convention.
--   * Capabilities are a text array with a CHECK against the known set, so a
--     typo in an admin payload is rejected by the database rather than
--     silently granting nothing. A plan that says `fiscal_report` instead of
--     `fiscal_reports` must fail loudly, not quietly withhold the feature the
--     customer paid for.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS max_clients integer,
  ADD COLUMN IF NOT EXISTS max_receipts_per_month integer,
  ADD COLUMN IF NOT EXISTS max_team_members integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS tagline text;

-- NULL is unlimited; a number must be a real allowance, never zero.
ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_max_clients_positive;
ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_max_clients_positive
  CHECK (max_clients IS NULL OR max_clients > 0);

ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_max_receipts_positive;
ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_max_receipts_positive
  CHECK (max_receipts_per_month IS NULL OR max_receipts_per_month > 0);

-- At least one seat: the account owner. Zero would lock a paying customer out
-- of their own data.
ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_seats_positive;
ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_seats_positive
  CHECK (max_team_members >= 1);

/*
 * The capability vocabulary.
 *
 * Kept here rather than only in TypeScript so that a direct SQL write — a
 * migration, a support script, a console session — cannot introduce a
 * capability nothing checks for. Adding one is deliberately a migration:
 * it should be as hard to invent a capability as it is to invent a column.
 */
ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_known_capabilities;
ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_known_capabilities
  CHECK (capabilities <@ ARRAY[
    'fiscal_reports',
    'tax_estimates',
    'priority_support',
    'team_members',
    'payment_gateway',
    'advanced_backup'
  ]::text[]);

/*
 * Receipts issued, by provider and calendar month.
 *
 * The quota is "per month", and answering that from `payments` means a scan
 * with a date range on every receipt written. This index makes the check a
 * lookup instead. Partial, because only real receipts count — a payment row
 * without a receipt number never consumed the allowance.
 */
CREATE INDEX IF NOT EXISTS payments_provider_receipt_month_idx
  ON payments (provider_id, paid_at)
  WHERE receipt_number IS NOT NULL;

-- The client quota needs no index of its own: `clients_provider_idx` already
-- leads with `provider_id`, so a count per provider reads straight off it.
-- A second index on the same leading column would cost every insert and
-- return nothing.
