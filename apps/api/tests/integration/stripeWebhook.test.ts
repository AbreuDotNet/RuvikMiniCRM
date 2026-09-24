import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, auth, drainQueue,
  type TestUser,
} from '../helpers/setup.js';
import { signForTest } from '../../src/modules/billing/stripe/signature.js';

let app: Express;

const WEBHOOK_SECRET = 'whsec_test_secret_for_the_stripe_endpoint';
const SECRET_KEY = 'rk_test_restricted_key_for_tests';

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => { await resetDatabase(); await seedCatalogue(); });

const db = async () => (await import('../../src/db/index.js')).getDb();
const envModule = async () => (await import('../../src/config/env.js')).env;

/**
 * Stripe is switched on by writing the credentials onto the resolved config.
 *
 * `stripeConfig` reads `env` once at module load, so the values are set on both
 * — the same pattern `adminMfaGate.test.ts` uses for `ADMIN_MFA_REQUIRED`, and
 * restored after every case so one test cannot leak live-looking credentials
 * into another.
 */
let original: { key: string | undefined; secret: string | undefined };

beforeEach(async () => {
  const env = (await envModule()) as Record<string, unknown>;
  original = {
    key: env.STRIPE_SECRET_KEY as string | undefined,
    secret: env.STRIPE_WEBHOOK_SECRET as string | undefined,
  };
});

afterEach(async () => {
  const env = (await envModule()) as Record<string, unknown>;
  env.STRIPE_SECRET_KEY = original.key;
  env.STRIPE_WEBHOOK_SECRET = original.secret;
  const { stripeConfig } = await import('../../src/modules/billing/stripe/config.js');
  (stripeConfig as unknown as Record<string, unknown>).secretKey = original.key ?? null;
  (stripeConfig as unknown as Record<string, unknown>).webhookSecret = original.secret ?? null;
  vi.unstubAllGlobals();
});

async function enableStripe(): Promise<void> {
  const env = (await envModule()) as Record<string, unknown>;
  env.STRIPE_SECRET_KEY = SECRET_KEY;
  env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const { stripeConfig } = await import('../../src/modules/billing/stripe/config.js');
  (stripeConfig as unknown as Record<string, unknown>).secretKey = SECRET_KEY;
  (stripeConfig as unknown as Record<string, unknown>).webhookSecret = WEBHOOK_SECRET;
}

/**
 * Posts a correctly signed event, exercising the real verifier.
 *
 * The same string is both signed and sent. Signing a Buffer and sending that
 * Buffer does not work: supertest re-encodes it, the bytes on the wire stop
 * matching the bytes that were signed, and every request comes back 403 —
 * which looks exactly like a configuration problem and is not one.
 */
function postEvent(event: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  return request(app)
    .post('/api/v1/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signForTest(Buffer.from(payload, 'utf8'), secret))
    .send(payload);
}

let eventSeq = 0;
const eventId = () => `evt_test_${++eventSeq}`;

const PRICE_ID = 'price_test_pro_monthly';
const SUB_ID = 'sub_test_123';
const CUS_ID = 'cus_test_123';

/** A provider on the Pro plan, with the plan carrying a Stripe price. */
async function providerOnPro(email = 'stripe-pro@test.local'): Promise<TestUser> {
  const provider = await registerUser(app, {
    role: 'provider', email, businessName: 'Stripe Plumbing',
  });
  const conn = await db();
  await conn.query(
    `UPDATE subscription_plans SET stripe_price_id = $1 WHERE code = 'pro'`,
    [PRICE_ID],
  );
  return provider;
}

/**
 * Stubs the one outbound call `sync.ts` makes: re-reading the subscription.
 * It re-reads rather than trusting the payload because Stripe does not order
 * webhooks, so the stub is what the assertions actually observe.
 */
function stubSubscriptionFetch(fields: Partial<{
  status: string; priceId: string; customerId: string;
  currentPeriodStart: number; currentPeriodEnd: number; cancelAtPeriodEnd: boolean;
}> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    id: SUB_ID,
    object: 'subscription',
    customer: fields.customerId ?? CUS_ID,
    status: fields.status ?? 'active',
    current_period_start: fields.currentPeriodStart ?? now,
    current_period_end: fields.currentPeriodEnd ?? now + 30 * 86_400,
    cancel_at_period_end: fields.cancelAtPeriodEnd ?? false,
    items: { data: [{ price: { id: fields.priceId ?? PRICE_ID } }] },
  };
  const spy = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const checkoutCompleted = (overrides: Record<string, unknown> = {}) => ({
  id: eventId(),
  type: 'checkout.session.completed',
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: 'cs_test_1',
      object: 'checkout.session',
      client_reference_id: null,
      customer: CUS_ID,
      subscription: SUB_ID,
      payment_status: 'paid',
      ...overrides,
    },
  },
});

async function subscriptionRow(providerId: string) {
  const conn = await db();
  const { rows } = await conn.query<{
    status: string; stripe_subscription_id: string | null; stripe_status: string | null;
    plan_code: string; cancel_at_period_end: boolean;
  }>(
    `SELECT s.status, s.stripe_subscription_id, s.stripe_status, s.cancel_at_period_end,
            sp.code AS plan_code
       FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.provider_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
    [providerId],
  );
  return rows[0] ?? null;
}

/* ========================================================================== */
/* The endpoint refuses what it cannot verify                                 */
/* ========================================================================== */

describe('the Stripe webhook endpoint', () => {
  it('refuses everything when Stripe is not configured', async () => {
    // Unverifiable events must not enter the ledger just because the endpoint
    // is mounted.
    await postEvent(checkoutCompleted()).expect(403);
  });

  it('rejects a body signed with the wrong secret', async () => {
    await enableStripe();
    await postEvent(checkoutCompleted(), 'whsec_the_wrong_secret_entirely').expect(403);
  });

  it('rejects a missing signature header', async () => {
    await enableStripe();
    await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(checkoutCompleted()))
      .expect(403);
  });

  it('acknowledges an event type it does not handle rather than erroring', async () => {
    await enableStripe();
    // A 4xx would count against the endpoint in Stripe's health statistics and
    // eventually get it disabled, for events deliberately ignored.
    const res = await postEvent({
      id: eventId(), type: 'radar.early_fraud_warning.created',
      created: 1, data: { object: {} },
    }).expect(200);
    expect(res.body).toMatchObject({ received: true, handled: false });
  });
});

/* ========================================================================== */
/* link_subscription                                                          */
/* ========================================================================== */

describe('checkout completion', () => {
  it('attaches the Stripe ids to the provider and activates the plan', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    stubSubscriptionFetch();

    await postEvent(checkoutCompleted({ client_reference_id: provider.providerId })).expect(200);

    const conn = await db();
    const { rows } = await conn.query<{ stripe_customer_id: string }>(
      'SELECT stripe_customer_id FROM providers WHERE id = $1',
      [provider.providerId],
    );
    expect(rows[0].stripe_customer_id).toBe(CUS_ID);

    const sub = await subscriptionRow(provider.providerId!);
    expect(sub).toMatchObject({
      status: 'active',
      stripe_subscription_id: SUB_ID,
      stripe_status: 'active',
      plan_code: 'pro',
    });
  });

  /**
   * Some payment methods settle after the customer leaves the page. Activating
   * on `completed` alone would grant a plan nobody has paid for.
   */
  it('does not activate a session whose payment has not settled', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    const spy = stubSubscriptionFetch();

    const res = await postEvent(checkoutCompleted({
      client_reference_id: provider.providerId,
      payment_status: 'unpaid',
    })).expect(200);

    expect(res.body.outcome).toBe('ignored');
    expect(spy).not.toHaveBeenCalled();
    expect(await subscriptionRow(provider.providerId!)).toBeNull();
  });

  it('activates it later, on async_payment_succeeded', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    stubSubscriptionFetch();

    await postEvent({
      ...checkoutCompleted({ client_reference_id: provider.providerId }),
      type: 'checkout.session.async_payment_succeeded',
    }).expect(200);

    expect(await subscriptionRow(provider.providerId!)).toMatchObject({ status: 'active' });
  });

  it('ignores a session naming a provider it does not know', async () => {
    await enableStripe();
    await providerOnPro();
    stubSubscriptionFetch();

    const res = await postEvent(checkoutCompleted({
      client_reference_id: '00000000-0000-4000-8000-000000000000',
    })).expect(200);

    expect(res.body.outcome).toBe('ignored');
  });
});

/* ========================================================================== */
/* Replay and retry                                                           */
/* ========================================================================== */

describe('redelivery', () => {
  it('treats a second delivery of a processed event as a duplicate', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    stubSubscriptionFetch();

    const event = checkoutCompleted({ client_reference_id: provider.providerId });
    await postEvent(event).expect(200);
    const second = await postEvent(event).expect(200);

    expect(second.body).toMatchObject({ duplicate: true });
  });

  /**
   * The bug this guards: recording an event with `ON CONFLICT DO NOTHING` and
   * treating any conflict as a duplicate means an event that failed
   * mid-processing is dismissed on Stripe's retry and never completes.
   */
  it('lets Stripe retry an event that failed part way through', async () => {
    await enableStripe();
    const provider = await providerOnPro();

    // First attempt: the subscription re-read fails, so the apply throws.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, text: async () => '{"error":{"message":"boom"}}',
    })));

    const event = checkoutCompleted({ client_reference_id: provider.providerId });
    await postEvent(event).expect(500);
    expect(await subscriptionRow(provider.providerId!)).toBeNull();

    // Stripe retries the same event id. It must be processed, not dismissed.
    stubSubscriptionFetch();
    const retry = await postEvent(event).expect(200);

    expect(retry.body).not.toHaveProperty('duplicate');
    expect(await subscriptionRow(provider.providerId!)).toMatchObject({ status: 'active' });
  });

  it('records the failure against the event for diagnosis', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, text: async () => '{"error":{"message":"boom"}}',
    })));

    await postEvent(checkoutCompleted({ client_reference_id: provider.providerId })).expect(500);

    const conn = await db();
    const { rows } = await conn.query<{ source: string; error: string | null }>(
      `SELECT source, error FROM webhook_events WHERE source = 'stripe'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBeTruthy();
  });
});

/* ========================================================================== */
/* Status translation and the grace window                                    */
/* ========================================================================== */

describe('subscription status', () => {
  async function linked(provider: TestUser) {
    stubSubscriptionFetch();
    await postEvent(checkoutCompleted({ client_reference_id: provider.providerId })).expect(200);
  }

  it('carries a cancellation scheduled for the period end', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    await linked(provider);

    stubSubscriptionFetch({ cancelAtPeriodEnd: true });
    await postEvent({
      id: eventId(), type: 'customer.subscription.updated',
      created: 1, data: { object: { id: SUB_ID, object: 'subscription' } },
    }).expect(200);

    expect(await subscriptionRow(provider.providerId!)).toMatchObject({
      status: 'active',
      cancel_at_period_end: true,
    });
  });

  /** `unpaid` is the end of Stripe's dunning, not the middle of it. */
  it('maps unpaid to expired rather than past_due', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    await linked(provider);

    stubSubscriptionFetch({ status: 'unpaid' });
    await postEvent({
      id: eventId(), type: 'customer.subscription.updated',
      created: 1, data: { object: { id: SUB_ID, object: 'subscription' } },
    }).expect(200);

    expect(await subscriptionRow(provider.providerId!)).toMatchObject({
      status: 'expired',
      stripe_status: 'unpaid',
    });
  });

  it('opens the grace window when a charge fails, once', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    await linked(provider);

    const failure = (id: string) => ({
      id, type: 'invoice.payment_failed', created: 1,
      data: {
        object: {
          id: `in_${id}`, object: 'invoice', subscription: SUB_ID, customer: CUS_ID,
          amount_paid: 0, amount_due: 1499, currency: 'usd',
        },
      },
    });

    await postEvent(failure(eventId())).expect(200);
    await postEvent(failure(eventId())).expect(200);

    expect(await subscriptionRow(provider.providerId!)).toMatchObject({ status: 'past_due' });

    const conn = await db();
    const { rows } = await conn.query<{ count: string }>(
      `SELECT count(*)::text FROM job_queue WHERE queue = 'billing.grace_expired'`,
    );
    // Deduped, so a run of retries inside one window cannot keep pushing the
    // expiry date out.
    expect(Number(rows[0].count)).toBe(1);
  });

  it('ends the subscription when Stripe deletes it', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    await linked(provider);

    await postEvent({
      id: eventId(), type: 'customer.subscription.deleted', created: 1,
      data: { object: { id: SUB_ID, object: 'subscription', status: 'canceled' } },
    }).expect(200);

    expect(await subscriptionRow(provider.providerId!)).toMatchObject({ status: 'cancelled' });
  });
});

/* ========================================================================== */
/* record_payment                                                             */
/* ========================================================================== */

describe('renewal payments', () => {
  const paidInvoice = (id: string, stripeInvoiceId: string) => ({
    id, type: 'invoice.paid', created: 1,
    data: {
      object: {
        id: stripeInvoiceId, object: 'invoice', subscription: SUB_ID, customer: CUS_ID,
        amount_paid: 1499, amount_due: 1499, currency: 'usd',
        hosted_invoice_url: 'https://invoice.stripe.com/i/test',
      },
    },
  });

  it('records the payment against the provider with Stripe\'s receipt link', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    stubSubscriptionFetch();
    await postEvent(checkoutCompleted({ client_reference_id: provider.providerId })).expect(200);

    await postEvent(paidInvoice(eventId(), 'in_test_1')).expect(200);

    const conn = await db();
    const { rows } = await conn.query<{
      kind: string; amount_cents: number; status: string; stripe_invoice_url: string | null;
    }>(
      `SELECT kind, amount_cents, status, stripe_invoice_url
         FROM payments WHERE provider_id = $1`,
      [provider.providerId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'subscription',
      amount_cents: 1499,
      status: 'succeeded',
      stripe_invoice_url: 'https://invoice.stripe.com/i/test',
    });
  });

  /**
   * `payments.external_ref` is uniquely indexed, so a redelivered `invoice.paid`
   * that slipped past the event-level dedupe still cannot double-count money.
   */
  it('does not record the same Stripe invoice twice', async () => {
    await enableStripe();
    const provider = await providerOnPro();
    stubSubscriptionFetch();
    await postEvent(checkoutCompleted({ client_reference_id: provider.providerId })).expect(200);

    await postEvent(paidInvoice(eventId(), 'in_test_dup')).expect(200);
    // A different event id carrying the same invoice — a real Stripe behaviour
    // when an endpoint is re-subscribed.
    const second = await postEvent(paidInvoice(eventId(), 'in_test_dup')).expect(200);

    expect(second.body.outcome).toBe('ignored');

    const conn = await db();
    const { rows } = await conn.query<{ count: string }>(
      'SELECT count(*)::text FROM payments WHERE provider_id = $1',
      [provider.providerId],
    );
    expect(Number(rows[0].count)).toBe(1);
  });
});

/* ========================================================================== */
/* The switchover                                                             */
/* ========================================================================== */

describe('POST /billing/subscription', () => {
  it('keeps using the manual flow when Stripe is not configured', async () => {
    const provider = await providerOnPro('manual-flow@test.local');

    const res = await request(app)
      .post('/api/v1/billing/subscription')
      .set(auth(provider.token))
      .set('idempotency-key', 'manual-1')
      .send({ planCode: 'pro' })
      .expect(201);

    // The manual flow's own shape: a reference to match a webhook against,
    // and no Stripe URL.
    expect(res.body.checkout).toHaveProperty('reference');
    expect(res.body.checkout).not.toHaveProperty('url');
  });

  it('returns a Stripe Checkout URL once configured', async () => {
    await enableStripe();
    const provider = await providerOnPro('stripe-flow@test.local');

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: 'cs_test_created',
        url: 'https://checkout.stripe.com/c/pay/cs_test_created',
      }),
    })));

    const res = await request(app)
      .post('/api/v1/billing/subscription')
      .set(auth(provider.token))
      .set('idempotency-key', 'stripe-1')
      .send({ planCode: 'pro' })
      .expect(201);

    expect(res.body).toMatchObject({
      status: 'pending_payment',
      checkout: { url: 'https://checkout.stripe.com/c/pay/cs_test_created' },
    });
    // Nothing is active yet — only the webhook grants the plan.
    expect(await subscriptionRow(provider.providerId!)).toMatchObject({
      status: 'pending_payment',
    });
  });

  it('never sends payment_method_types, so dynamic payment methods stay on', async () => {
    await enableStripe();
    const provider = await providerOnPro('dynamic-pm@test.local');

    const spy = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }),
    }));
    vi.stubGlobal('fetch', spy);

    await request(app)
      .post('/api/v1/billing/subscription')
      .set(auth(provider.token)).set('idempotency-key', 'dyn-1')
      .send({ planCode: 'pro' })
      .expect(201);

    const body = String((spy.mock.calls[0][1] as { body: string }).body);
    expect(body).not.toContain('payment_method_types');
    // And it does tag the flow, which 2026-03-25.dahlia onwards requires.
    expect(body).toContain('integration_identifier');
  });

  it('still activates a free plan inline, with no Stripe call', async () => {
    await enableStripe();
    const provider = await providerOnPro('free-plan@test.local');
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    const res = await request(app)
      .post('/api/v1/billing/subscription')
      .set(auth(provider.token)).set('idempotency-key', 'free-1')
      .send({ planCode: 'starter' })
      .expect(201);

    expect(res.body.status).toBe('active');
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* The portal                                                                 */
/* ========================================================================== */

describe('POST /billing/portal', () => {
  it('refuses when Stripe is not configured', async () => {
    const provider = await providerOnPro('portal-off@test.local');
    await request(app)
      .post('/api/v1/billing/portal')
      .set(auth(provider.token))
      .expect(409);
  });

  it('refuses a provider who has never checked out', async () => {
    await enableStripe();
    const provider = await providerOnPro('portal-new@test.local');
    const res = await request(app)
      .post('/api/v1/billing/portal')
      .set(auth(provider.token))
      .expect(409);
    expect(res.body.error.message).toMatch(/choose a plan first/i);
  });

  it('returns a portal URL once they have a Stripe customer', async () => {
    await enableStripe();
    const provider = await providerOnPro('portal-ok@test.local');
    const conn = await db();
    await conn.query('UPDATE providers SET stripe_customer_id = $2 WHERE id = $1', [
      provider.providerId, CUS_ID,
    ]);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ url: 'https://billing.stripe.com/p/session_test' }),
    })));

    const res = await request(app)
      .post('/api/v1/billing/portal')
      .set(auth(provider.token))
      .expect(200);

    expect(res.body.url).toBe('https://billing.stripe.com/p/session_test');
  });

  it('needs a provider session', async () => {
    await request(app).post('/api/v1/billing/portal').expect(401);
  });
});

/* ========================================================================== */
/* Notifications reach the provider                                           */
/* ========================================================================== */

describe('what the provider is told', () => {
  it('notifies them when a renewal charge fails', async () => {
    await enableStripe();
    const provider = await providerOnPro('notify-fail@test.local');
    stubSubscriptionFetch();
    await postEvent(checkoutCompleted({ client_reference_id: provider.providerId })).expect(200);

    await postEvent({
      id: eventId(), type: 'invoice.payment_failed', created: 1,
      data: {
        object: {
          id: 'in_fail', object: 'invoice', subscription: SUB_ID, customer: CUS_ID,
          amount_paid: 0, amount_due: 1499, currency: 'usd',
        },
      },
    }).expect(200);
    await drainQueue();

    const conn = await db();
    const { rows } = await conn.query<{ type: string; body: string }>(
      `SELECT type, body FROM notifications WHERE user_id = $1 AND type = 'subscription.payment_failed'`,
      [provider.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toMatch(/7 days/);
  });

  it('warns them before a trial ends', async () => {
    await enableStripe();
    const provider = await providerOnPro('notify-trial@test.local');
    stubSubscriptionFetch();
    await postEvent(checkoutCompleted({ client_reference_id: provider.providerId })).expect(200);

    await postEvent({
      id: eventId(), type: 'customer.subscription.trial_will_end', created: 1,
      data: { object: { id: SUB_ID, object: 'subscription' } },
    }).expect(200);

    const conn = await db();
    const { rows } = await conn.query<{ count: string }>(
      `SELECT count(*)::text FROM notifications
        WHERE user_id = $1 AND type = 'subscription.trial_ending'`,
      [provider.id],
    );
    expect(Number(rows[0].count)).toBe(1);
  });
});
