/**
 * Stripe's subscription vocabulary, translated into ours.
 *
 * Kept as a pure function with no imports so it can be read, reviewed and
 * tested on its own. Getting this wrong is expensive in a specific way: our
 * `status` decides whether a provider appears in search at all
 * (`LIVE_SUBSCRIPTION` in the discovery module), so a mistranslation either
 * hides somebody who is paying or keeps somebody visible who is not.
 */

/** Every status Stripe can report on a subscription. */
export const STRIPE_SUBSCRIPTION_STATUSES = [
  'incomplete', 'incomplete_expired', 'trialing', 'active',
  'past_due', 'canceled', 'unpaid', 'paused',
] as const;

export type StripeSubscriptionStatus = (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];

/** Ours, from the `subscriptions_status_check` constraint. */
export type RuvikSubscriptionStatus =
  | 'pending_payment' | 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

/**
 * The translation, with the reasoning kept next to each decision.
 *
 * Note the two that are not obvious:
 *
 * - `unpaid` is not `past_due`. Stripe reaches `unpaid` only after its dunning
 *   has run out of retries, which is the end of the road, not the middle of
 *   it. Mapping it to `past_due` would leave the provider visible in search
 *   for another grace window they have already had.
 *
 * - `paused` keeps them visible. It happens when a trial ends with no payment
 *   method, so it is closer to "not paid yet" than to "gone". Our own
 *   `billing.grace_expired` job moves it on after the grace window, which is
 *   the behaviour we want rather than an indefinite free listing.
 */
export function toRuvikStatus(stripe: string): RuvikSubscriptionStatus {
  switch (stripe) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'paused': return 'past_due';
    case 'canceled': return 'cancelled';
    case 'unpaid': return 'expired';
    case 'incomplete': return 'pending_payment';
    case 'incomplete_expired': return 'expired';
    default:
      // An unknown status is a Stripe API change. Failing closed keeps a
      // provider listed rather than dropping them out of search on a status
      // nobody has read yet — the safer error, and one the logs will show.
      return 'past_due';
  }
}

/** Statuses under which the provider is entitled to the plan's features. */
export function isEntitled(status: RuvikSubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

/**
 * Whether a status change should open our grace window.
 *
 * Stripe runs its own retry schedule, so this exists as a backstop rather than
 * a second dunning process. See the README: the two windows have to be
 * configured to agree, or a provider is cut off while Stripe is still trying.
 */
export function opensGraceWindow(
  previous: RuvikSubscriptionStatus | null,
  next: RuvikSubscriptionStatus,
): boolean {
  return next === 'past_due' && previous !== 'past_due';
}

/** Seconds since the epoch, as Stripe sends them, to a Date. */
export function fromStripeTimestamp(seconds: number | null | undefined): Date | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}
