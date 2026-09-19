import { stripeConfig, requireStripe } from './config.js';
import { logger } from '../../../lib/logger.js';

/**
 * A small REST client for the handful of Stripe calls this product makes.
 *
 * ## Why not the official SDK
 *
 * This integration needs three endpoints: create a Checkout Session, create a
 * Billing Portal session, and read a subscription. That is a smaller surface
 * than the SDK's own configuration, and the two things the SDK is genuinely
 * worth having for — webhook signature verification and typed events — are
 * handled here by `signature.ts` (twenty lines, same algorithm) and by reading
 * only the fields we use in `events.ts`.
 *
 * Swapping in `npm i stripe` later is a change to this file alone: everything
 * else in the folder talks to the functions below, not to HTTP.
 *
 * ## What this does have to get right
 *
 * - **Form encoding.** Stripe's API is `application/x-www-form-urlencoded`
 *   with bracketed keys for nesting, not JSON. `encodeForm` below.
 * - **Idempotency.** Every POST carries an `Idempotency-Key`. Without it a
 *   network timeout that is actually a success creates a second subscription
 *   the next time the request is retried.
 * - **A pinned API version**, so Stripe rolling forward does not change
 *   behaviour on their schedule.
 */

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

/**
 * Flattens an object into Stripe's bracketed form encoding.
 *
 * `{ a: { b: 1 }, c: [ { d: 2 } ] }` becomes `a[b]=1&c[0][d]=2`.
 * Undefined and null are dropped rather than sent as the strings "undefined"
 * and "null", which Stripe would accept and store.
 */
export function encodeForm(input: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === 'object') {
          parts.push(encodeForm(item as Record<string, unknown>, `${name}[${i}]`));
        } else if (item !== undefined && item !== null) {
          parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object') {
      parts.push(encodeForm(value as Record<string, unknown>, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.filter(Boolean).join('&');
}

interface RequestOptions {
  /** Required on every POST. Reused verbatim by Stripe to collapse retries. */
  idempotencyKey?: string;
  timeoutMs?: number;
}

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  opts: RequestOptions = {},
): Promise<T> {
  const { secretKey } = requireStripe();

  if (method === 'POST' && !opts.idempotencyKey) {
    // A programming error, not a runtime condition: every POST in this folder
    // passes one, and a new call site that forgets should fail loudly here
    // rather than quietly double-charging somebody months later.
    throw new Error(`Stripe POST ${path} was made without an idempotency key.`);
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${secretKey}`,
    'stripe-version': stripeConfig.apiVersion,
  };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  try {
    const res = await fetch(`${stripeConfig.apiBase}${path}`, {
      method,
      headers,
      body: body ? encodeForm(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};

    if (!res.ok) {
      const err = parsed.error ?? {};
      // Stripe's message is safe to log but not to show a provider verbatim —
      // it can name internal ids. Callers surface their own wording.
      logger.warn(
        { status: res.status, type: err.type, code: err.code, path },
        'stripe request failed',
      );
      throw new StripeError(err.message ?? 'Stripe request failed.', res.status, err.type, err.code);
    }

    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

export const stripe = {
  get: <T>(path: string, opts?: RequestOptions) => call<T>('GET', path, undefined, opts),
  post: <T>(path: string, body: Record<string, unknown>, opts: RequestOptions) =>
    call<T>('POST', path, body, opts),
};
