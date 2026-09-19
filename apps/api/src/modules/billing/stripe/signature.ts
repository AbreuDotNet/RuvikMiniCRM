import crypto from 'node:crypto';

/**
 * Stripe webhook signature verification.
 *
 * The scheme is `Stripe-Signature: t=<unix>,v1=<hmac>,v1=<hmac>…` where each
 * hmac is SHA-256 over `${t}.${rawBody}` keyed with the endpoint's signing
 * secret. The timestamp is inside the signed material, so a captured request
 * cannot be replayed once the tolerance has passed.
 *
 * Two details that are easy to get wrong and are handled here:
 *
 * 1. **The raw body.** The signature covers the bytes Stripe sent, not the
 *    re-serialised JSON. Parsing and re-encoding changes key order and
 *    whitespace and every signature fails. `app.ts` already captures
 *    `req.rawBody` for exactly this reason.
 *
 * 2. **More than one v1.** During a secret rotation Stripe signs with both the
 *    old and the new secret and sends two `v1` values. Reading only the first
 *    breaks every rotation, so all of them are checked.
 *
 * This is deliberately not the Stripe SDK's `constructEvent`. The algorithm is
 * twenty lines, the repo already verifies the identical scheme for its own
 * billing webhook, and it keeps the signature path free of a dependency.
 */

/** Stripe's default tolerance. Five minutes, matching the existing webhook. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface SignatureCheck {
  ok: boolean;
  /** Why it failed, for the log. Never returned to the caller. */
  reason?: 'missing_header' | 'malformed_header' | 'timestamp_outside_tolerance' | 'no_match';
}

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  now: Date = new Date(),
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing_header' };

  let timestamp: number | null = null;
  const candidates: string[] = [];

  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') candidates.push(value);
  }

  if (timestamp === null || !Number.isFinite(timestamp) || !candidates.length) {
    return { ok: false, reason: 'malformed_header' };
  }

  const ageSeconds = Math.abs(now.getTime() / 1000 - timestamp);
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_outside_tolerance' };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');

  for (const candidate of candidates) {
    // timingSafeEqual throws on a length mismatch, so the lengths are compared
    // first — that comparison leaks only the length, which is public.
    if (candidate.length !== expected.length) continue;
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
      return { ok: true };
    }
  }

  return { ok: false, reason: 'no_match' };
}

/**
 * Builds a header the way Stripe would. Test-only: it exists so the tests
 * exercise the real verifier rather than a stub of it.
 */
export function signForTest(rawBody: Buffer, secret: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  return `t=${t},v1=${v1}`;
}
