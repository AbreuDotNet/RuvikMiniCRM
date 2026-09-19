/**
 * Stripe subscription billing.
 *
 * Nothing in this folder is wired into the running application yet: the live
 * `POST /billing/subscription` still uses the manual flow in
 * `../service.ts`. That is deliberate — the switch-over is one explicit step,
 * taken when the keys exist, and until then the build stays green and no
 * provider is routed at a gateway that is not set up.
 *
 * See README.md for what to configure and what order to do it in.
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
