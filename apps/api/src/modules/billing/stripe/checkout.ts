import { stripe } from './client.js';
import { stripeConfig } from './config.js';
import { readSubscription, type SubscriptionFields } from './events.js';

/**
 * The two hosted pages this integration uses, and nothing else.
 *
 * Both are Stripe-hosted on purpose. Collecting a card in our own form means
 * the application is in scope for PCI DSS; redirecting to Checkout keeps the
 * card details off this server entirely. The same reasoning applies to the
 * Billing Portal: plan changes, payment-method updates and cancellations are
 * a whole product surface that Stripe already maintains, and the alternative
 * is building proration and dunning UI from scratch.
 */

export interface CheckoutSession {
  id: string;
  /** Where to send the provider's browser. */
  url: string;
}

/**
 * Starts a subscription checkout for one provider on one plan.
 *
 * `clientReferenceId` carries our provider id through Stripe and comes back on
 * `checkout.session.completed`. It is the only thread tying the Stripe objects
 * to our records, so it is set here and never omitted.
 *
 * `idempotencyKey` must be stable for a given attempt — the route already
 * mints one per request — so a provider who double-taps "Choose plan" on a
 * slow connection gets one session rather than two subscriptions.
 */
export async function createCheckoutSession(input: {
  providerId: string;
  /** The Stripe price for the chosen plan, from `subscription_plans`. */
  priceId: string;
  /** Existing Stripe customer, when the provider has subscribed before. */
  customerId?: string | null;
  /** Used only when there is no customer yet, so Stripe can prefill it. */
  email?: string | null;
  trialDays?: number | null;
  idempotencyKey: string;
}): Promise<CheckoutSession> {
  const body: Record<string, unknown> = {
    mode: 'subscription',
    client_reference_id: input.providerId,
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${stripeConfig.returnUrl}?checkout=done`,
    cancel_url: `${stripeConfig.returnUrl}?checkout=cancelled`,
    // Re-attaching the provider id to the subscription itself means a later
    // event that does not carry the checkout session can still be matched.
    subscription_data: {
      metadata: { provider_id: input.providerId },
      ...(input.trialDays && input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
    },
    // Sales tax on the subscription fee itself is a separate question from the
    // sales tax a provider charges their own clients. Left off until somebody
    // decides it with a CPA — see docs/us-invoicing-audit.md.
    automatic_tax: { enabled: false },
  };

  if (input.customerId) body.customer = input.customerId;
  else if (input.email) body.customer_email = input.email;

  const session = await stripe.post<{ id: string; url: string | null }>(
    '/checkout/sessions',
    body,
    { idempotencyKey: input.idempotencyKey },
  );

  if (!session.url) {
    throw new Error(`Stripe returned a checkout session with no URL (${session.id}).`);
  }
  return { id: session.id, url: session.url };
}

/**
 * Opens the Billing Portal, where the provider changes plan, updates their
 * card or cancels.
 *
 * This is what closes three of the gaps the MVP audit listed — plan change
 * with proration, stored payment method, and a cancellation flow — without
 * building any of them. Stripe applies the changes and tells us through
 * `customer.subscription.updated`.
 */
export async function createPortalSession(input: {
  customerId: string;
  idempotencyKey: string;
}): Promise<{ url: string }> {
  const session = await stripe.post<{ url: string }>(
    '/billing_portal/sessions',
    { customer: input.customerId, return_url: stripeConfig.returnUrl },
    { idempotencyKey: input.idempotencyKey },
  );
  return { url: session.url };
}

/**
 * Re-reads a subscription from Stripe.
 *
 * Used when an event arrives whose payload might be stale — Stripe does not
 * guarantee webhook ordering, so an `updated` delivered late can carry an
 * older status than one already applied. Fetching is the cheap way to be sure
 * the status written is the current one.
 */
export async function fetchSubscription(subscriptionId: string): Promise<SubscriptionFields> {
  const raw = await stripe.get<Record<string, unknown>>(`/subscriptions/${subscriptionId}`);
  return readSubscription(raw);
}
