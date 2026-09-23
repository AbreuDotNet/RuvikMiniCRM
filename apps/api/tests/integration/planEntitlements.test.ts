import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, createAdmin, elevateToMfa,
  subscribeProvider, auth, type TestUser,
} from '../helpers/setup.js';

let app: Express;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => { await resetDatabase(); await seedCatalogue(); });

/**
 * Creates a plan with explicit entitlements.
 *
 * Written straight to the table rather than through the admin API so a failure
 * in the limits points at the limits, not at the admin routes.
 */
async function makePlan(input: {
  code: string;
  priceCents?: number;
  maxClients?: number | null;
  maxReceiptsPerMonth?: number | null;
  maxServices?: number | null;
  maxQuotesPerMonth?: number | null;
  capabilities?: string[];
  isActive?: boolean;
  sortOrder?: number;
}): Promise<string> {
  const { getDb } = await import('../../src/db/index.js');
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    // Upsert, because `resetDatabase` truncates the tenant tables but leaves
    // the catalogue standing — two tests using the same plan code would
    // otherwise collide on the unique index rather than test anything.
    `INSERT INTO subscription_plans
       (code, name, price_cents, interval, max_clients, max_receipts_per_month,
        max_services, max_quotes_per_month, capabilities, is_active, sort_order)
     VALUES ($1,$2,$3,'month',$4,$5,$6,$7,$8::text[],$9,$10)
     ON CONFLICT (code) DO UPDATE SET
       price_cents = EXCLUDED.price_cents,
       max_clients = EXCLUDED.max_clients,
       max_receipts_per_month = EXCLUDED.max_receipts_per_month,
       max_services = EXCLUDED.max_services,
       max_quotes_per_month = EXCLUDED.max_quotes_per_month,
       capabilities = EXCLUDED.capabilities,
       is_active = EXCLUDED.is_active,
       sort_order = EXCLUDED.sort_order
     RETURNING id`,
    [
      input.code, input.code.toUpperCase(), input.priceCents ?? 1000,
      input.maxClients ?? null, input.maxReceiptsPerMonth ?? null,
      input.maxServices ?? null, input.maxQuotesPerMonth ?? null,
      input.capabilities ?? [], input.isActive ?? true, input.sortOrder ?? 500,
    ],
  );
  return rows[0].id;
}

/** Retires every plan but the ones a test just made, so "cheapest" is knowable. */
async function retireSeededPlans(...keep: string[]): Promise<void> {
  const { getDb } = await import('../../src/db/index.js');
  const db = await getDb();
  await db.query(
    'UPDATE subscription_plans SET is_active = false WHERE NOT (code = ANY($1::text[]))',
    [keep],
  );
}

function addClient(provider: TestUser, name: string) {
  return request(app)
    .post('/api/v1/provider/clients')
    .set(auth(provider.token))
    .send({ fullName: name });
}

async function makeProvider(email = 'limits@test.local'): Promise<TestUser> {
  return registerUser(app, { role: 'provider', email, businessName: 'Limits Co' });
}

describe('client quota', () => {
  it('refuses the client that would cross the plan allowance', async () => {
    await makePlan({ code: 'tiny', maxClients: 2 });
    const provider = await makeProvider();
    await subscribeProvider(provider.providerId!, 'active', 'tiny');

    await addClient(provider, 'One').expect(201);
    await addClient(provider, 'Two').expect(201);

    const refused = await addClient(provider, 'Three').expect(409);
    expect(refused.body.error.message).toMatch(/includes 2 clients/i);
    // The numbers travel with the error so a client can render "2 of 2"
    // without asking again.
    expect(refused.body.error.details).toMatchObject({
      reason: 'plan_limit_reached', limit: 2, used: 2, resource: 'clients',
    });
  });

  it('closes the second door: a job that creates its client inline', async () => {
    // The quota is on the table, not on one endpoint. Creating a job with a
    // new client attached writes to `clients` just the same.
    await makePlan({ code: 'tiny', maxClients: 1 });
    const provider = await makeProvider();
    await subscribeProvider(provider.providerId!, 'active', 'tiny');

    await addClient(provider, 'Only One').expect(201);

    await request(app)
      .post('/api/v1/provider/jobs')
      .set(auth(provider.token))
      .send({ newClient: { fullName: 'Sneaky Second' }, title: 'Back door job' })
      .expect(409);
  });

  it('treats a null allowance as unlimited', async () => {
    await makePlan({ code: 'roomy', maxClients: null });
    const provider = await makeProvider();
    await subscribeProvider(provider.providerId!, 'active', 'roomy');

    for (let i = 0; i < 12; i += 1) {
      await addClient(provider, `Client ${i}`).expect(201);
    }
  });
});

describe('receipt quota', () => {
  /** Invoices a job and pays it, which is what mints a receipt. */
  async function issueAndPay(provider: TestUser, clientId: string, cents: number) {
    const job = await request(app)
      .post('/api/v1/provider/jobs')
      .set(auth(provider.token))
      .send({ clientId, title: 'Work' })
      .expect(201);

    const invoice = await request(app)
      .post('/api/v1/invoices')
      .set(auth(provider.token))
      .send({
        jobId: job.body.id,
        lines: [{ description: 'Labour', quantity: 1, unitPriceCents: cents, taxRateBp: 0 }],
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/invoices/${invoice.body.id}/send`)
      .set(auth(provider.token))
      .expect(200);

    return request(app)
      .post(`/api/v1/invoices/${invoice.body.id}/payments`)
      .set(auth(provider.token))
      .send({ amountCents: cents, method: 'cash' });
  }

  it('stops at the monthly allowance, and refuses before the money is written', async () => {
    await makePlan({ code: 'twoReceipts', maxReceiptsPerMonth: 2 });
    const provider = await makeProvider();
    await subscribeProvider(provider.providerId!, 'active', 'twoReceipts');

    const client = await addClient(provider, 'Payer').expect(201);
    const clientId = client.body.id;

    expect((await issueAndPay(provider, clientId, 1000)).status).toBe(200);
    expect((await issueAndPay(provider, clientId, 1000)).status).toBe(200);

    const refused = await issueAndPay(provider, clientId, 1000);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/includes 2 receipts a month/i);

    // The third invoice must still be unpaid: refusing after taking the money
    // would leave the customer paid up with no receipt.
    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text FROM payments
        WHERE provider_id = $1 AND receipt_number IS NOT NULL`,
      [provider.providerId],
    );
    expect(Number(rows[0].count)).toBe(2);
  });
});

describe('quote quota', () => {
  it('enforces max_quotes_per_month, which nothing used to read', async () => {
    await makePlan({ code: 'oneQuote', maxQuotesPerMonth: 1 });
    const provider = await makeProvider();
    await subscribeProvider(provider.providerId!, 'active', 'oneQuote');

    const client = await addClient(provider, 'Quoted').expect(201);
    const job = await request(app)
      .post('/api/v1/provider/jobs')
      .set(auth(provider.token))
      .send({ clientId: client.body.id, title: 'Quotable' })
      .expect(201);

    const line = { description: 'Work', quantity: 1, unitPriceCents: 5000, taxRateBp: 0 };

    await request(app).post('/api/v1/quotes')
      .set(auth(provider.token)).send({ jobId: job.body.id, lines: [line] })
      .expect(201);

    await request(app).post('/api/v1/quotes')
      .set(auth(provider.token)).send({ jobId: job.body.id, lines: [line] })
      .expect(409);
  });
});

describe('entitlements without a live subscription', () => {
  it('falls back to the cheapest active plan, not to no limits', async () => {
    // The failure this guards against: a provider with no subscription once
    // got unlimited listings while a paying one was capped.
    await makePlan({ code: 'cheapest', priceCents: 0, maxClients: 1 });
    await makePlan({ code: 'dearest', priceCents: 9900, maxClients: null });
    // The seeded catalogue also has a free tier; retire it so the cheapest
    // active plan is unambiguously the one under test.
    await retireSeededPlans('cheapest', 'dearest');

    const provider = await makeProvider();
    // Deliberately no subscription at all.

    await addClient(provider, 'First').expect(201);
    await addClient(provider, 'Second').expect(409);
  });

  it('keeps entitlements through the past_due grace period', async () => {
    await makePlan({ code: 'generous', priceCents: 5000, maxClients: 5 });
    await makePlan({ code: 'stingy', priceCents: 0, maxClients: 1 });
    await retireSeededPlans('generous', 'stingy');

    const provider = await makeProvider();
    await subscribeProvider(provider.providerId!, 'past_due', 'generous');

    // Past due is the grace window. Dropping them to the free tier's limits
    // mid-grace would make the grace meaningless.
    await addClient(provider, 'One').expect(201);
    await addClient(provider, 'Two').expect(201);
  });
});

describe('GET /provider/entitlements', () => {
  it('reports the same limits the server enforces, plus usage', async () => {
    await makePlan({
      code: 'reported',
      maxClients: 3,
      capabilities: ['fiscal_reports', 'priority_support'],
    });
    const provider = await makeProvider();
    await subscribeProvider(provider.providerId!, 'active', 'reported');
    await addClient(provider, 'One').expect(201);

    const res = await request(app)
      .get('/api/v1/provider/entitlements')
      .set(auth(provider.token))
      .expect(200);

    expect(res.body.plan.code).toBe('reported');
    expect(res.body.limits.maxClients).toBe(3);
    expect(res.body.usage.clients).toMatchObject({ used: 1, limit: 3, exhausted: false });
    expect(res.body.capabilities).toEqual(
      expect.arrayContaining(['fiscal_reports', 'priority_support']),
    );
    // Honest about what the plan grants but the product cannot do yet.
    expect(res.body.unimplemented).toContain('fiscal_reports');
    expect(res.body.unimplemented).not.toContain('priority_support');
  });

  it('says when the limits come from the fallback rather than a subscription', async () => {
    await makePlan({ code: 'fallback', priceCents: 0, maxClients: 4 });
    const provider = await makeProvider();

    const res = await request(app)
      .get('/api/v1/provider/entitlements')
      .set(auth(provider.token))
      .expect(200);

    expect(res.body.fromLiveSubscription).toBe(false);
    expect(res.body.subscriptionStatus).toBeNull();
  });
});

describe('admin plan management', () => {
  async function adminPair() {
    const admin = await createAdmin(app);
    return { admin, mfa: await elevateToMfa(admin) };
  }

  it('lists plans with their subscriber counts and the capability vocabulary', async () => {
    const { admin } = await adminPair();
    await makePlan({ code: 'listed', maxClients: 9 });
    const provider = await makeProvider();
    await subscribeProvider(provider.providerId!, 'active', 'listed');

    const res = await request(app)
      .get('/api/v1/admin/plans')
      .set(auth(admin.token))
      .expect(200);

    const listed = res.body.data.find((p: any) => p.code === 'listed');
    expect(listed.limits.maxClients).toBe(9);
    expect(listed.subscribers.live).toBe(1);
    expect(res.body.knownCapabilities).toContain('tax_estimates');
  });

  it('creates a plan, and only with a two-factor session', async () => {
    const { admin, mfa } = await adminPair();

    const payload = {
      code: 'made-by-admin',
      name: 'Made by admin',
      priceCents: 1499,
      maxClients: 25,
      maxReceiptsPerMonth: 100,
      capabilities: ['fiscal_reports'],
      features: ['25 clients'],
    };

    // Reading the catalogue is aal1; changing it is not.
    await request(app).post('/api/v1/admin/plans')
      .set(auth(admin.token)).send(payload).expect(403);

    const created = await request(app).post('/api/v1/admin/plans')
      .set(auth(mfa)).send(payload).expect(201);
    expect(created.body.id).toBeTruthy();

    const listed = await request(app).get('/api/v1/admin/plans')
      .set(auth(admin.token)).expect(200);
    const plan = listed.body.data.find((p: any) => p.code === 'made-by-admin');
    expect(plan.priceCents).toBe(1499);
    expect(plan.limits.maxReceiptsPerMonth).toBe(100);
  });

  it('refuses a capability outside the known vocabulary', async () => {
    const { mfa } = await adminPair();
    await request(app).post('/api/v1/admin/plans')
      .set(auth(mfa))
      .send({
        code: 'typo-plan', name: 'Typo', priceCents: 0,
        // Singular: the sort of slip that would otherwise grant nothing and
        // look like it granted something.
        capabilities: ['fiscal_report'],
      })
      .expect(422);
  });

  it('edits a plan, and the change takes effect for the provider on it', async () => {
    const { mfa } = await adminPair();
    const planId = await makePlan({ code: 'editable', maxClients: 1 });
    const provider = await makeProvider();
    await subscribeProvider(provider.providerId!, 'active', 'editable');

    await addClient(provider, 'First').expect(201);
    await addClient(provider, 'Second').expect(409);

    await request(app)
      .patch(`/api/v1/admin/plans/${planId}`)
      .set(auth(mfa))
      .send({ maxClients: 5 })
      .expect(200);

    // Entitlements are read at the moment of the action, so raising the plan
    // frees the provider immediately — no re-subscribe, no cache to bust.
    await addClient(provider, 'Second').expect(201);
  });

  it('will not retire the only active plan', async () => {
    const { mfa } = await adminPair();
    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();

    // Leave exactly one plan standing — and make sure it is actually active,
    // since the catalogue survives `resetDatabase` and an earlier test may
    // have retired this very row.
    await db.query(
      `UPDATE subscription_plans SET is_active = (code = 'starter')`,
    );
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM subscription_plans WHERE code = 'starter'`,
    );

    const refused = await request(app)
      .patch(`/api/v1/admin/plans/${rows[0].id}`)
      .set(auth(mfa))
      .send({ isActive: false })
      .expect(409);

    expect(refused.body.error.message).toMatch(/only active plan/i);
  });

  it('records who changed a price, and from what to what', async () => {
    const { admin, mfa } = await adminPair();
    const planId = await makePlan({ code: 'repriced', priceCents: 1000 });

    await request(app)
      .patch(`/api/v1/admin/plans/${planId}`)
      .set(auth(mfa))
      .send({ priceCents: 1999 })
      .expect(200);

    const logs = await request(app)
      .get('/api/v1/admin/audit-logs')
      .query({ action: 'admin.plan_updated' })
      .set(auth(admin.token))
      .expect(200);

    const entry = logs.body.data[0];
    expect(entry.metadata).toMatchObject({ priceBefore: 1000, priceAfter: 1999 });
  });
});
