import { env } from '../../../config/env.js';

/**
 * Stripe configuration, read once.
 *
 * Nothing here throws on a missing key. The integration has to be able to sit
 * in the repository, compile and run its tests before anybody has an account —
 * so "not configured" is a state the code reports, not a crash at boot.
 */
export const stripeConfig = {
  secretKey: env.STRIPE_SECRET_KEY ?? null,
  webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
  /**
   * Pinned on every request. Stripe rolls its API forward and an unpinned
   * integration changes behaviour on their schedule rather than ours.
   * Raise it deliberately, with the changelog open.
   */
  apiVersion: '2025-08-27.basil',
  apiBase: 'https://api.stripe.com/v1',
  /** Where Checkout and the Billing Portal send the provider back to. */
  returnUrl: `${env.WEB_BASE_URL}/subscription`,
} as const;

/** True once both the API key and the webhook secret are present. */
export function isStripeConfigured(): boolean {
  return Boolean(stripeConfig.secretKey && stripeConfig.webhookSecret);
}

/**
 * Guards a code path that cannot work without credentials.
 *
 * The message names the variable rather than saying "misconfigured": the
 * person reading it at 2am is looking for which line of .env is missing.
 */
export function requireStripe(): { secretKey: string; webhookSecret: string } {
  if (!stripeConfig.secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not set — Stripe billing is disabled.');
  }
  if (!stripeConfig.webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set — Stripe billing is disabled.');
  }
  return { secretKey: stripeConfig.secretKey, webhookSecret: stripeConfig.webhookSecret };
}
