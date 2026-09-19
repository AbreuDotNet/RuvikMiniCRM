import { describe, it, expect } from 'vitest';
import {
  verifyStripeSignature, signForTest, SIGNATURE_TOLERANCE_SECONDS,
} from '../../src/modules/billing/stripe/signature.js';
import {
  toRuvikStatus, isEntitled, opensGraceWindow, fromStripeTimestamp,
  STRIPE_SUBSCRIPTION_STATUSES,
} from '../../src/modules/billing/stripe/mapping.js';
import {
  intentFor, HANDLED_EVENTS, SUBSCRIBED_EVENT_TYPES,
  readCheckoutSession, readSubscription, readInvoice,
} from '../../src/modules/billing/stripe/events.js';
import { encodeForm } from '../../src/modules/billing/stripe/client.js';
import { isStripeConfigured } from '../../src/modules/billing/stripe/config.js';

const SECRET = 'whsec_test_secret_value_for_signing';

/* ========================================================================== */
/* Signature                                                                  */
/* ========================================================================== */

describe('webhook signature', () => {
  const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'invoice.paid' }));

  it('accepts a signature Stripe would have sent', () => {
    expect(verifyStripeSignature(body, signForTest(body, SECRET), SECRET).ok).toBe(true);
  });

  it('rejects a missing header rather than trusting the body', () => {
    const res = verifyStripeSignature(body, undefined, SECRET);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('missing_header');
  });

  it('rejects a body altered after signing', () => {
    const header = signForTest(body, SECRET);
    const tampered = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'invoice.paid', extra: 1 }));
    expect(verifyStripeSignature(tampered, header, SECRET).ok).toBe(false);
  });

  it('rejects a signature from the wrong secret', () => {
    expect(verifyStripeSignature(body, signForTest(body, 'whsec_other'), SECRET).ok).toBe(false);
  });

  it('rejects a replay from outside the tolerance window', () => {
    const old = new Date(Date.now() - (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000);
    const res = verifyStripeSignature(body, signForTest(body, SECRET, old), SECRET);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('timestamp_outside_tolerance');
  });

  it('accepts a request from just inside the window', () => {
    const recent = new Date(Date.now() - (SIGNATURE_TOLERANCE_SECONDS - 30) * 1000);
    expect(verifyStripeSignature(body, signForTest(body, SECRET, recent), SECRET).ok).toBe(true);
  });

  it('accepts either signature during a secret rotation', () => {
    // Stripe signs with both secrets while a rollover is in progress and sends
    // two v1 values. Reading only the first would break every rotation.
    const t = Math.floor(Date.now() / 1000);
    const valid = signForTest(body, SECRET).split('v1=')[1];
    const header = `t=${t},v1=deadbeef,v1=${valid}`;
    expect(verifyStripeSignature(body, header, SECRET).ok).toBe(true);
  });

  it('rejects a malformed header without throwing', () => {
    for (const header of ['', 'garbage', 't=abc,v1=x', 't=123', 'v1=abc']) {
      expect(() => verifyStripeSignature(body, header, SECRET)).not.toThrow();
      expect(verifyStripeSignature(body, header, SECRET).ok).toBe(false);
    }
  });

  it('does not throw when the candidate length differs from the digest', () => {
    // timingSafeEqual throws on a length mismatch; a short signature must be a
    // rejection, not a 500 that tells an attacker they found an edge.
    const t = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(body, `t=${t},v1=ab`, SECRET).ok).toBe(false);
  });
});

/* ========================================================================== */
/* Status mapping                                                             */
/* ========================================================================== */

describe('status mapping', () => {
  it('translates every status Stripe can send', () => {
    for (const s of STRIPE_SUBSCRIPTION_STATUSES) {
      expect(toRuvikStatus(s), s).toBeTruthy();
    }
  });

  it('keeps a paying subscriber visible', () => {
    expect(toRuvikStatus('active')).toBe('active');
    expect(toRuvikStatus('trialing')).toBe('trialing');
    expect(isEntitled(toRuvikStatus('active'))).toBe(true);
    expect(isEntitled(toRuvikStatus('trialing'))).toBe(true);
  });

  it('keeps a first failed charge inside the grace window', () => {
    expect(toRuvikStatus('past_due')).toBe('past_due');
    expect(isEntitled('past_due')).toBe(true);
  });

  it('does not give a second grace window to a subscription Stripe gave up on', () => {
    // 'unpaid' is the end of Stripe's dunning, not the middle of it. Mapping
    // it to past_due would restart our own seven days on top of theirs.
    expect(toRuvikStatus('unpaid')).toBe('expired');
    expect(isEntitled('expired')).toBe(false);
  });

  it('treats a cancelled subscription as cancelled, not expired', () => {
    expect(toRuvikStatus('canceled')).toBe('cancelled');
    expect(isEntitled('cancelled')).toBe(false);
  });

  it('treats an unfinished checkout as awaiting payment', () => {
    expect(toRuvikStatus('incomplete')).toBe('pending_payment');
    expect(toRuvikStatus('incomplete_expired')).toBe('expired');
    expect(isEntitled('pending_payment')).toBe(false);
  });

  it('fails closed on a status nobody has read yet', () => {
    // A Stripe API addition must not drop a paying provider out of search.
    expect(toRuvikStatus('some_future_status')).toBe('past_due');
    expect(isEntitled(toRuvikStatus('some_future_status'))).toBe(true);
  });

  it('opens the grace window only on the way into past_due', () => {
    expect(opensGraceWindow('active', 'past_due')).toBe(true);
    expect(opensGraceWindow('past_due', 'past_due')).toBe(false);
    expect(opensGraceWindow(null, 'past_due')).toBe(true);
    expect(opensGraceWindow('active', 'cancelled')).toBe(false);
  });

  it('reads Stripe timestamps as seconds, not milliseconds', () => {
    const d = fromStripeTimestamp(1_760_000_000);
    expect(d?.getUTCFullYear()).toBe(2025);
    expect(fromStripeTimestamp(null)).toBeNull();
    expect(fromStripeTimestamp(undefined)).toBeNull();
  });
});

/* ========================================================================== */
/* Event routing                                                              */
/* ========================================================================== */

describe('event routing', () => {
  it('ignores an event it was not asked to handle', () => {
    expect(intentFor('charge.dispute.created')).toBeNull();
    expect(intentFor('customer.created')).toBeNull();
  });

  it('routes the events the subscription lifecycle depends on', () => {
    expect(intentFor('checkout.session.completed')).toBe('link_subscription');
    expect(intentFor('customer.subscription.updated')).toBe('sync_subscription');
    expect(intentFor('customer.subscription.deleted')).toBe('end_subscription');
    expect(intentFor('invoice.paid')).toBe('record_payment');
    expect(intentFor('invoice.payment_failed')).toBe('payment_failed');
  });

  it('publishes the same list the dashboard endpoint must subscribe to', () => {
    // If these drift, an event is handled in code and never delivered — the
    // failure mode is silence, which is the hardest kind to notice.
    expect(SUBSCRIBED_EVENT_TYPES.sort()).toEqual(Object.keys(HANDLED_EVENTS).sort());
    expect(SUBSCRIBED_EVENT_TYPES).toContain('checkout.session.completed');
  });
});

/* ========================================================================== */
/* Reading Stripe's payloads                                                  */
/* ========================================================================== */

describe('reading a checkout session', () => {
  it('recovers the provider id we sent through Stripe', () => {
    const fields = readCheckoutSession({
      client_reference_id: 'prov-123',
      customer: 'cus_1',
      subscription: 'sub_1',
      payment_status: 'paid',
    });
    expect(fields).toEqual({
      clientReferenceId: 'prov-123', customerId: 'cus_1',
      subscriptionId: 'sub_1', paymentStatus: 'paid',
    });
  });

  it('reads an expanded object as well as a bare id', () => {
    // Stripe expands references or leaves them as strings depending on the
    // request, so the handler must not depend on an expansion set elsewhere.
    const fields = readCheckoutSession({
      client_reference_id: 'prov-9',
      customer: { id: 'cus_2', object: 'customer' },
      subscription: { id: 'sub_2' },
    });
    expect(fields.customerId).toBe('cus_2');
    expect(fields.subscriptionId).toBe('sub_2');
  });

  it('returns null rather than the string "undefined" for a missing field', () => {
    const fields = readCheckoutSession({});
    expect(fields.clientReferenceId).toBeNull();
    expect(fields.customerId).toBeNull();
  });
});

describe('reading a subscription', () => {
  it('picks up the price, which is what maps to one of our plans', () => {
    const fields = readSubscription({
      id: 'sub_3', customer: 'cus_3', status: 'active',
      current_period_start: 1_760_000_000, current_period_end: 1_762_592_000,
      cancel_at_period_end: true,
      items: { data: [{ price: { id: 'price_pro_monthly' } }] },
    });
    expect(fields.priceId).toBe('price_pro_monthly');
    expect(fields.cancelAtPeriodEnd).toBe(true);
    expect(toRuvikStatus(fields.status)).toBe('active');
  });

  it('survives a subscription with no items rather than throwing', () => {
    const fields = readSubscription({ id: 'sub_4', status: 'canceled' });
    expect(fields.priceId).toBeNull();
    expect(fields.cancelAtPeriodEnd).toBe(false);
  });
});

describe('reading an invoice', () => {
  it('reads the amount actually paid, in cents', () => {
    const fields = readInvoice({
      id: 'in_1', subscription: 'sub_5', customer: 'cus_5',
      amount_paid: 2900, amount_due: 2900, currency: 'usd',
      hosted_invoice_url: 'https://invoice.stripe.com/x',
      payment_intent: 'pi_1',
    });
    expect(fields.amountPaidCents).toBe(2900);
    expect(fields.currency).toBe('USD');
    expect(fields.hostedInvoiceUrl).toBe('https://invoice.stripe.com/x');
  });

  it('reports zero rather than NaN on a missing amount', () => {
    expect(readInvoice({ id: 'in_2' }).amountPaidCents).toBe(0);
  });
});

/* ========================================================================== */
/* Form encoding                                                              */
/* ========================================================================== */

describe('form encoding', () => {
  it('nests objects the way Stripe expects', () => {
    expect(encodeForm({ subscription_data: { metadata: { provider_id: 'p1' } } }))
      .toBe('subscription_data%5Bmetadata%5D%5Bprovider_id%5D=p1');
  });

  it('indexes arrays', () => {
    expect(encodeForm({ line_items: [{ price: 'price_1', quantity: 1 }] }))
      .toBe('line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1');
  });

  it('drops undefined and null instead of sending them as words', () => {
    // Stripe would accept "customer=null" and store the string.
    expect(encodeForm({ a: 1, b: undefined, c: null })).toBe('a=1');
  });

  it('escapes values that would otherwise break the encoding', () => {
    expect(encodeForm({ success_url: 'https://x.test/s?a=1&b=2' }))
      .toBe('success_url=https%3A%2F%2Fx.test%2Fs%3Fa%3D1%26b%3D2');
  });

  it('encodes booleans, which Stripe reads as true/false', () => {
    expect(encodeForm({ automatic_tax: { enabled: false } }))
      .toBe('automatic_tax%5Benabled%5D=false');
  });
});

/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

describe('configuration', () => {
  it('reports that Stripe is not set up rather than crashing at boot', () => {
    // The whole folder has to be able to live in the repository before anybody
    // has an account. This is the test that keeps that true.
    expect(typeof isStripeConfigured()).toBe('boolean');
    expect(isStripeConfigured()).toBe(false);
  });
});
