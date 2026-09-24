/**
 * Which Stripe events matter, and what each one means here.
 *
 * Stripe sends well over a hundred event types. Subscribing to all of them and
 * branching in the handler is how a webhook endpoint becomes unreadable, so
 * this file is the whole list: if it is not here, it is ignored on purpose.
 *
 * Pure and dependency-free, so the routing decision can be tested without a
 * database, a network or a Stripe account.
 */

/**
 * What the application should do about an event, independent of how.
 *
 * Separating the intent from the execution is what makes the handler
 * reviewable: the question "does this event change the subscription status?"
 * is answered by a table rather than by reading through a switch full of SQL.
 */
export type StripeIntent =
  /** Link the Stripe customer and subscription to our provider. */
  | 'link_subscription'
  /** Re-read the subscription and write its status and period across. */
  | 'sync_subscription'
  /** The subscription ended. */
  | 'end_subscription'
  /** Money arrived: record the payment and issue a receipt. */
  | 'record_payment'
  /** A charge failed: open the grace window and tell the provider. */
  | 'payment_failed'
  /** Tell the provider their trial is nearly over. */
  | 'warn_trial_ending';

export const HANDLED_EVENTS: Readonly<Record<string, StripeIntent>> = {
  // Checkout finished. This is the only event that carries our own
  // client_reference_id, so it is where the Stripe ids get attached to the
  // provider. Everything after it is keyed on those ids.
  'checkout.session.completed': 'link_subscription',

  /*
   * Some payment methods do not settle while the customer is still on the
   * page. For those, `completed` arrives with `payment_status: 'unpaid'` and
   * the money lands later under this event — so an integration that handles
   * only `completed` never activates them. Both are gated on `payment_status`
   * in the handler, which is why they can share an intent.
   */
  'checkout.session.async_payment_succeeded': 'link_subscription',

  'customer.subscription.created': 'sync_subscription',
  'customer.subscription.updated': 'sync_subscription',
  'customer.subscription.paused': 'sync_subscription',
  'customer.subscription.resumed': 'sync_subscription',
  'customer.subscription.deleted': 'end_subscription',
  'customer.subscription.trial_will_end': 'warn_trial_ending',

  // invoice.paid rather than invoice.payment_succeeded: the former fires for
  // every path that settles an invoice, including one paid out of band or
  // marked paid in the dashboard.
  'invoice.paid': 'record_payment',
  'invoice.payment_failed': 'payment_failed',
};

/** The list to select when creating the endpoint in the Stripe dashboard. */
export const SUBSCRIBED_EVENT_TYPES = Object.keys(HANDLED_EVENTS);

export function intentFor(eventType: string): StripeIntent | null {
  return HANDLED_EVENTS[eventType] ?? null;
}

/* -------------------------------------------------------------------------- */
/* The slice of Stripe's payloads this integration reads                      */
/* -------------------------------------------------------------------------- */

/**
 * Only the fields actually used are typed.
 *
 * Typing the whole of Stripe's objects by hand would be wrong within a release
 * and invites reading fields nobody checked. Anything not listed here is
 * deliberately not consumed.
 */
export interface StripeEventEnvelope {
  id: string;
  type: string;
  created: number;
  /** Stripe's own idempotency marker for a retried delivery. */
  request?: { idempotency_key?: string | null } | null;
  data: { object: Record<string, unknown> };
}

export interface CheckoutSessionFields {
  /** Our provider id, sent when the session was created. */
  clientReferenceId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  /** 'paid' | 'unpaid' | 'no_payment_required' */
  paymentStatus: string | null;
}

export interface SubscriptionFields {
  id: string;
  customerId: string | null;
  status: string;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** The price the subscription is on, which maps to one of our plans. */
  priceId: string | null;
}

export interface InvoiceFields {
  id: string;
  subscriptionId: string | null;
  customerId: string | null;
  amountPaidCents: number;
  amountDueCents: number;
  currency: string;
  /** Stripe's hosted receipt, worth storing so the provider can fetch it. */
  hostedInvoiceUrl: string | null;
  paymentIntentId: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Stripe expands some references and leaves others as bare id strings
 * depending on the request. Both shapes are read so the handler does not
 * depend on an expansion parameter set somewhere else.
 */
function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object' && 'id' in value) {
    return str((value as { id: unknown }).id);
  }
  return null;
}

export function readCheckoutSession(object: Record<string, unknown>): CheckoutSessionFields {
  return {
    clientReferenceId: str(object.client_reference_id),
    customerId: idOf(object.customer),
    subscriptionId: idOf(object.subscription),
    paymentStatus: str(object.payment_status),
  };
}

export function readSubscription(object: Record<string, unknown>): SubscriptionFields {
  const items = object.items as { data?: Array<{ price?: unknown }> } | undefined;
  return {
    id: String(object.id ?? ''),
    customerId: idOf(object.customer),
    status: String(object.status ?? ''),
    currentPeriodStart: num(object.current_period_start),
    currentPeriodEnd: num(object.current_period_end),
    cancelAtPeriodEnd: object.cancel_at_period_end === true,
    priceId: idOf(items?.data?.[0]?.price),
  };
}

export function readInvoice(object: Record<string, unknown>): InvoiceFields {
  return {
    id: String(object.id ?? ''),
    subscriptionId: idOf(object.subscription),
    customerId: idOf(object.customer),
    amountPaidCents: num(object.amount_paid) ?? 0,
    amountDueCents: num(object.amount_due) ?? 0,
    currency: String(object.currency ?? 'usd').toUpperCase(),
    hostedInvoiceUrl: str(object.hosted_invoice_url),
    paymentIntentId: idOf(object.payment_intent),
  };
}
