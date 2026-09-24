/**
 * Stripe subscription billing.
 *
 * This is wired in. `POST /billing/subscription` routes through Stripe Checkout
 * whenever there are credentials *and* the chosen plan carries a
 * `stripe_price_id`; otherwise the manual flow in `../service.ts` runs
 * unchanged, so a deployment with no keys behaves exactly as it did before.
 *
 * The pieces, in the order a request meets them:
 *
 *   `config`    — credentials, API version, whether Stripe is usable at all
 *   `client`    — the small REST client (form encoding, idempotency, retries)
 *   `checkout`  — Checkout Session, Billing Portal session, read a subscription
 *   `signature` — webhook signature verification over the raw body
 *   `events`    — which events matter, and what each one means
 *   `sync`      — carrying that meaning into Ruvik's own tables
 *   `mapping`   — Stripe's subscription vocabulary translated into ours
 *
 * See docs/stripe-integration.md for the dashboard setup this expects, and why
 * the SaaS fee bills an ordinary Customer rather than using `customer_account`.
 */

export { stripeConfig, isStripeConfigured, requireStripe } from './config.js';
export { stripe, StripeError, encodeForm } from './client.js';
export {
  createCheckoutSession, createPortalSession, fetchSubscription,
  type CheckoutSession,
} from './checkout.js';
export {
  verifyStripeSignature, signForTest, SIGNATURE_TOLERANCE_SECONDS,
  type SignatureCheck,
} from './signature.js';
export {
  HANDLED_EVENTS, SUBSCRIBED_EVENT_TYPES, intentFor,
  readCheckoutSession, readSubscription, readInvoice,
  type StripeIntent, type StripeEventEnvelope,
  type CheckoutSessionFields, type SubscriptionFields, type InvoiceFields,
} from './events.js';
export {
  STRIPE_SUBSCRIPTION_STATUSES, toRuvikStatus, isEntitled, opensGraceWindow,
  fromStripeTimestamp,
  type StripeSubscriptionStatus, type RuvikSubscriptionStatus,
} from './mapping.js';
export { applyIntent, type AppliedIntent } from './sync.js';
