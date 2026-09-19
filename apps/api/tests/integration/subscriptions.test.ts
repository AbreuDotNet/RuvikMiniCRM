import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, publishProvider,
  subscribeProvider, drainQueue, auth,
} from '../helpers/setup.js';

let app: Express;
let categoryId: string;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => {
  await resetDatabase();
  ({ categoryId } = await seedCatalogue());
});

const db = async () => (await import('../../src/db/index.js')).getDb();

function signBilling(body: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto
    .createHmac('sha256', process.env.BILLING_WEBHOOK_SECRET!)
    .update(`${t}.${body}`)
    .digest('hex');
  return `t=${t},v1=${v1}`;
}

/** A published provider with one active listing, so it can be searched for. */
async function listedProvider(email: string, businessName = 'Listed Co') {
  const provider = await registerUser(app, { role: 'provider', email, businessName });
  await publishProvider(provider.providerId!);
  await request(app)
    .post('/api/v1/provider/services').set(auth(provider.token))
    .send({
      categoryId, title: 'Emergency pipe repair', pricingType: 'fixed',
      priceCents: 15000, status: 'active',
    })
    .expect(201);
  return provider;
}

const searchCount = async () => {
  const res = await request(app).get('/api/v1/search/services').expect(200);
  return res.body.data.length as number;
};

/* ========================================================================== */
/* Free plans                                                                 */
/* ========================================================================== */

describe('a free plan has nothing to wait for', () => {
  it('activates immediately instead of waiting for a payment that never comes', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'free@test.local', businessName: 'Free Co',
    });

    const res = await request(app)
      .post('/api/v1/billing/subscription').set(auth(provider.token))
      .send({ planCode: 'starter' }).expect(201);

    // The old behaviour parked every plan in pending_payment awaiting a
    // gateway webhook. A $0 plan produces no charge, so no webhook was ever
    // coming and the provider stayed stuck there for good.
    expect(res.body.status).toBe('active');
    expect(res.body.checkout).toBeNull();

    const sub = await request(app)
      .get('/api/v1/billing/subscription').set(auth(provider.token)).expect(200);
    expect(sub.body.subscription.status).toBe('active');
    expect(sub.body.subscription.currentPeriodEnd).toBeTruthy();
  });

  it('records no payment for a charge that never happened', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'nopay@test.local', businessName: 'No Pay Co',
    });
    await request(app)
      .post('/api/v1/billing/subscription').set(auth(provider.token))
      .send({ planCode: 'starter' }).expect(201);

    const sub = await request(app)
      .get('/api/v1/billing/subscription').set(auth(provider.token)).expect(200);
    // A zero-value "succeeded" payment would be a phantom line in their
    // billing history for money that never moved.
    expect(sub.body.subscription.payments).toHaveLength(0);
  });

  it('still books the renewal check', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'renewfree@test.local', businessName: 'Renew Free Co',
    });
    await request(app)
      .post('/api/v1/billing/subscription').set(auth(provider.token))
      .send({ planCode: 'starter' }).expect(201);

    const conn = await db();
    const { rows } = await conn.query<any>(
      `SELECT queue FROM job_queue WHERE queue = 'billing.renew' AND status = 'pending'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('leaves a priced plan exactly as it was — only the webhook activates it', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'paid@test.local', businessName: 'Paid Co',
    });

    const res = await request(app)
      .post('/api/v1/billing/subscription').set(auth(provider.token))
      .send({ planCode: 'pro' }).expect(201);

    expect(res.body.status).toBe('pending_payment');
    expect(res.body.checkout.reference).toMatch(/^sub_/);

    // Nothing the client can send activates it.
    const sub = await request(app)
      .get('/api/v1/billing/subscription').set(auth(provider.token)).expect(200);
    expect(sub.body.subscription.status).toBe('pending_payment');
  });
});

/* ========================================================================== */
/* Plan limits                                                                */
/* ========================================================================== */

describe('plan limits fail closed', () => {
  it('applies the cheapest plan limits to a provider with no live subscription', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'nolimit@test.local', businessName: 'No Limit Co',
    });
    // No subscription at all — which used to mean no cap whatsoever, so the
    // provider paying nothing outranked the one paying for Starter.
    const conn = await db();
    await conn.query('DELETE FROM subscriptions WHERE provider_id = $1', [provider.providerId]);

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/api/v1/provider/services').set(auth(provider.token))
        .send({ categoryId, title: `Listing ${i}`, pricingType: 'request_quote' })
        .expect(201);
    }

    const res = await request(app)
      .post('/api/v1/provider/services').set(auth(provider.token))
      .send({ categoryId, title: 'One too many', pricingType: 'request_quote' })
      .expect(409);
    expect(res.body.error.message).toMatch(/3 listings/);
  });

  it('applies the limit of a lapsed provider’s plan, not none at all', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'lapsed@test.local', businessName: 'Lapsed Co',
    });
    await subscribeProvider(provider.providerId!, 'cancelled');

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/api/v1/provider/services').set(auth(provider.token))
        .send({ categoryId, title: `Listing ${i}`, pricingType: 'request_quote' })
        .expect(201);
    }
    await request(app)
      .post('/api/v1/provider/services').set(auth(provider.token))
      .send({ categoryId, title: 'One too many', pricingType: 'request_quote' })
      .expect(409);
  });

  it('still honours a larger paid plan', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'pro-limit@test.local', businessName: 'Pro Limit Co',
    });
    await subscribeProvider(provider.providerId!, 'active', 'pro');

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/v1/provider/services').set(auth(provider.token))
        .send({ categoryId, title: `Listing ${i}`, pricingType: 'request_quote' })
        .expect(201);
    }
  });
});

/* ========================================================================== */
/* Visibility follows the subscription                                        */
/* ========================================================================== */

describe('public visibility follows the subscription', () => {
  it('shows a provider whose subscription is live', async () => {
    await listedProvider('visible@test.local');
    expect(await searchCount()).toBe(1);
  });

  it('hides a cancelled provider from search, the profile and the home feed', async () => {
    const provider = await listedProvider('cancelled@test.local', 'Cancelled Co');
    const before = await request(app).get('/api/v1/search/services').expect(200);
    const serviceId = before.body.data[0].id;
    const slug = before.body.data[0].provider.slug;

    await subscribeProvider(provider.providerId!, 'cancelled');

    // This is what the cancellation dialog in the app has always promised.
    expect(await searchCount()).toBe(0);
    await request(app).get(`/api/v1/providers/${slug}`).expect(404);
    await request(app).get(`/api/v1/services/${serviceId}`).expect(404);

    const featured = await request(app).get('/api/v1/providers/featured').expect(200);
    expect(featured.body.data).toHaveLength(0);
  });

  it('hides an expired provider', async () => {
    const provider = await listedProvider('expired@test.local', 'Expired Co');
    await subscribeProvider(provider.providerId!, 'expired');
    expect(await searchCount()).toBe(0);
  });

  it('keeps a past_due provider visible — that is the grace window', async () => {
    const provider = await listedProvider('grace@test.local', 'Grace Co');
    await subscribeProvider(provider.providerId!, 'past_due');
    expect(await searchCount()).toBe(1);
  });

  it('hides a provider who never chose a plan', async () => {
    const provider = await listedProvider('noplan@test.local', 'No Plan Co');
    const conn = await db();
    await conn.query('DELETE FROM subscriptions WHERE provider_id = $1', [provider.providerId]);
    expect(await searchCount()).toBe(0);
  });

  it('does not touch the provider’s own published flag, so paying again is enough', async () => {
    const provider = await listedProvider('restore@test.local', 'Restore Co');
    await subscribeProvider(provider.providerId!, 'expired');
    expect(await searchCount()).toBe(0);

    // Visibility is derived, so nothing has to be restored by hand.
    await subscribeProvider(provider.providerId!, 'active');
    expect(await searchCount()).toBe(1);

    const conn = await db();
    const { rows } = await conn.query<any>(
      'SELECT is_published FROM providers WHERE id = $1', [provider.providerId],
    );
    expect(rows[0].is_published).toBe(true);
  });
});

/* ========================================================================== */
/* The grace window ends                                                      */
/* ========================================================================== */

describe('the grace window ends', () => {
  /** Runs the grace job now rather than waiting seven days. */
  async function runGraceNow() {
    const conn = await db();
    await conn.query(
      `UPDATE job_queue SET run_at = now() WHERE queue = 'billing.grace_expired' AND status = 'pending'`,
    );
    await drainQueue();
  }

  async function failCharge(providerId: string) {
    const conn = await db();
    const { rows } = await conn.query<any>(
      'SELECT external_ref FROM subscriptions WHERE provider_id = $1', [providerId],
    );
    const payload = JSON.stringify({
      id: `evt_fail_${Math.random().toString(16).slice(2)}`,
      type: 'payment.failed',
      data: { reference: rows[0].external_ref, reason: 'card_declined' },
    });
    await request(app).post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('X-Ruvik-Signature', signBilling(payload))
      .send(payload).expect(200);
  }

  /** A provider mid-checkout on a priced plan, listed and paid up to now. */
  async function payingProvider(email: string) {
    const provider = await listedProvider(email, 'Paying Co');
    const conn = await db();
    await conn.query('DELETE FROM subscriptions WHERE provider_id = $1', [provider.providerId]);
    await request(app)
      .post('/api/v1/billing/subscription').set(auth(provider.token))
      .send({ planCode: 'pro' }).expect(201);
    return provider;
  }

  it('books an expiry when a charge fails, and the provider stays listed meanwhile', async () => {
    const provider = await payingProvider('fail@test.local');
    // Activate first so the provider is genuinely live before the charge fails.
    await subscribeProvider(provider.providerId!, 'active', 'pro');
    await failCharge(provider.providerId!);

    const conn = await db();
    const { rows: subs } = await conn.query<any>(
      'SELECT status FROM subscriptions WHERE provider_id = $1', [provider.providerId],
    );
    expect(subs[0].status).toBe('past_due');
    expect(await searchCount()).toBe(1);

    const { rows: jobs } = await conn.query<any>(
      `SELECT run_at FROM job_queue WHERE queue = 'billing.grace_expired' AND status = 'pending'`,
    );
    expect(jobs).toHaveLength(1);
    const days = (new Date(jobs[0].run_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.5);
    expect(days).toBeLessThan(7.5);
  });

  it('expires the subscription and drops the listing when the window closes', async () => {
    const provider = await payingProvider('expire-me@test.local');
    await subscribeProvider(provider.providerId!, 'active', 'pro');
    await failCharge(provider.providerId!);
    await runGraceNow();

    const conn = await db();
    const { rows } = await conn.query<any>(
      'SELECT status FROM subscriptions WHERE provider_id = $1', [provider.providerId],
    );
    expect(rows[0].status).toBe('expired');
    expect(await searchCount()).toBe(0);
  });

  it('does nothing if the provider paid before the window closed', async () => {
    const provider = await payingProvider('paid-in-time@test.local');
    await subscribeProvider(provider.providerId!, 'active', 'pro');
    await failCharge(provider.providerId!);

    // They settle up; the queued expiry is still there and must be harmless.
    await subscribeProvider(provider.providerId!, 'active', 'pro');
    await runGraceNow();

    const conn = await db();
    const { rows } = await conn.query<any>(
      'SELECT status FROM subscriptions WHERE provider_id = $1', [provider.providerId],
    );
    expect(rows[0].status).toBe('active');
    expect(await searchCount()).toBe(1);
  });

  it('books one expiry, not one per failed charge', async () => {
    const provider = await payingProvider('retry@test.local');
    await subscribeProvider(provider.providerId!, 'active', 'pro');
    await failCharge(provider.providerId!);
    await failCharge(provider.providerId!);
    await failCharge(provider.providerId!);

    const conn = await db();
    const { rows } = await conn.query<any>(
      `SELECT id FROM job_queue WHERE queue = 'billing.grace_expired' AND status = 'pending'`,
    );
    // Three declines in a week must not mean three deadlines.
    expect(rows).toHaveLength(1);
  });

  it('tells the provider their listings have come down', async () => {
    const provider = await payingProvider('notified@test.local');
    await subscribeProvider(provider.providerId!, 'active', 'pro');
    await failCharge(provider.providerId!);
    await runGraceNow();

    const notes = await request(app)
      .get('/api/v1/notifications').set(auth(provider.token)).expect(200);
    expect(notes.body.data.some((n: any) => n.type === 'subscription.expired')).toBe(true);
  });
});
