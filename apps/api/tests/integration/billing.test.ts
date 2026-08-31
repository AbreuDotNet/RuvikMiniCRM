import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, publishProvider, auth,
} from '../helpers/setup.js';

let app: Express;
let categoryId: string;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => {
  await resetDatabase();
  ({ categoryId } = await seedCatalogue());
});

async function providerWithJob(email = 'billing@test.local') {
  const provider = await registerUser(app, { role: 'provider', email, businessName: 'Billing Test Co' });
  await publishProvider(provider.providerId!);
  const client = await request(app)
    .post('/api/v1/provider/clients').set(auth(provider.token))
    .send({ fullName: 'Billing Client', email: 'client@test.local', phone: '+18095550101' })
    .expect(201);
  const job = await request(app)
    .post('/api/v1/provider/jobs').set(auth(provider.token))
    .send({ clientId: client.body.id, title: 'Water heater replacement' })
    .expect(201);
  return { provider, clientId: client.body.id as string, jobId: job.body.id as string };
}

describe('sales tax settings', () => {
  it('starts at zero rather than shipping a rate that would be wrong everywhere', async () => {
    const { provider } = await providerWithJob();
    const res = await request(app)
      .get('/api/v1/provider/tax-settings').set(auth(provider.token)).expect(200);
    expect(res.body.defaultTaxRateBp).toBe(0);
    expect(res.body.taxState).toBeNull();
  });

  it('stores a state and rate the provider configures', async () => {
    const { provider } = await providerWithJob();
    const res = await request(app)
      .patch('/api/v1/provider/tax-settings').set(auth(provider.token))
      .send({ taxState: 'tx', defaultTaxRateBp: 825 }).expect(200);
    expect(res.body.taxState).toBe('TX');       // normalised
    expect(res.body.defaultTaxRateBp).toBe(825);
  });

  it('rejects a rate no US jurisdiction charges', async () => {
    // 18% is the Dominican ITBIS — the figure this app used to default to.
    // The highest US combined rate is around 12%, so this is always a mistake.
    const { provider } = await providerWithJob();
    await request(app)
      .patch('/api/v1/provider/tax-settings').set(auth(provider.token))
      .send({ defaultTaxRateBp: 1800 }).expect(422);
  });

  it('accepts the highest rates that do occur in the US', async () => {
    const { provider } = await providerWithJob();
    for (const bp of [0, 725, 1025, 1200]) {
      await request(app)
        .patch('/api/v1/provider/tax-settings').set(auth(provider.token))
        .send({ defaultTaxRateBp: bp }).expect(200);
    }
  });

  it('rejects a malformed state code', async () => {
    const { provider } = await providerWithJob();
    await request(app)
      .patch('/api/v1/provider/tax-settings').set(auth(provider.token))
      .send({ taxState: 'Texas' }).expect(422);
  });
});

describe('per-line tax treatment', () => {
  it('refuses an untaxed line with no reason', async () => {
    const { provider, jobId } = await providerWithJob();
    const res = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .set('idempotency-key', 'k-noreason')
      .send({
        jobId,
        lines: [{ description: 'Labour', quantity: 1, unitPriceCents: 30_000, taxRateBp: 825, taxTreatment: 'not_subject' }],
      })
      .expect(422);
    expect(JSON.stringify(res.body)).toContain('taxReason');
  });

  it('accepts an untaxed line when the reason is given, and charges nothing on it', async () => {
    // Texas-shaped job: materials taxable, residential labour out of scope.
    const { provider, jobId } = await providerWithJob();
    const res = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .set('idempotency-key', 'k-mixed')
      .send({
        jobId,
        lines: [
          { description: 'Water heater unit', quantity: 1, unitPriceCents: 60_000, taxRateBp: 825, taxTreatment: 'taxable' },
          {
            description: 'Installation labour', quantity: 4, unitPriceCents: 9_000, taxRateBp: 825,
            taxTreatment: 'not_subject', taxReason: 'Labour on residential real property',
          },
        ],
      })
      .expect(201);

    const quote = await request(app)
      .get(`/api/v1/quotes/${res.body.id}`).set(auth(provider.token)).expect(200);

    expect(quote.body.subtotalCents).toBe(96_000);
    // Only the unit is taxed: 60000 * 8.25% = 4950.
    expect(quote.body.taxCents).toBe(4950);
    expect(quote.body.totalCents).toBe(100_950);
  });

  it('never charges tax on a relieved line even if a rate is left on it', async () => {
    const { provider, jobId } = await providerWithJob();
    const res = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .set('idempotency-key', 'k-exempt')
      .send({
        jobId,
        lines: [{
          description: 'Parts for resale', quantity: 1, unitPriceCents: 50_000, taxRateBp: 825,
          taxTreatment: 'exempt', taxReason: 'Resale certificate on file',
        }],
      })
      .expect(201);

    const quote = await request(app)
      .get(`/api/v1/quotes/${res.body.id}`).set(auth(provider.token)).expect(200);
    expect(quote.body.taxCents).toBe(0);
    expect(quote.body.totalCents).toBe(50_000);
  });
});

describe('quote to invoice: the tax basis travels', () => {
  it('carries the treatment and its reason onto the invoice', async () => {
    // Copying only the rate used to silently re-tax a line the customer had
    // accepted as relieved, and lose the evidence for why.
    // A customer-originated job, because only the customer can accept a quote.
    const provider = await registerUser(app, {
      role: 'provider', email: 'flow@test.local', businessName: 'Flow Test Co',
    });
    await publishProvider(provider.providerId!);
    const service = await request(app)
      .post('/api/v1/provider/services').set(auth(provider.token))
      .send({
        categoryId,
        title: 'Water heater replacement',
        shortDescription: 'Same-day replacement',
        pricingType: 'request_quote',
        estimatedDurationMin: 240,
        status: 'active',
      })
      .expect(201);
    const serviceId = service.body.id as string;
    const customer = await registerUser(app, { role: 'customer', email: 'flowcust@test.local' });
    const jobRes = await request(app)
      .post('/api/v1/customer/requests').set(auth(customer.token))
      .send({
        providerId: provider.providerId, serviceId,
        title: 'Water heater replacement',
        description: 'The unit is leaking and needs replacing.',
      })
      .expect(201);
    const jobId = jobRes.body.id as string;

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('idempotency-key', 'q-1')
      .send({
        jobId,
        lines: [
          { description: 'Materials', quantity: 1, unitPriceCents: 40_000, taxRateBp: 825 },
          {
            description: 'Labour', quantity: 1, unitPriceCents: 60_000, taxRateBp: 825,
            taxTreatment: 'not_subject', taxReason: 'Labour on residential real property',
          },
        ],
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token))
      .set('idempotency-key', 'q-send').expect(200);
    await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/respond`).set(auth(customer.token))
      .send({ decision: 'accept' }).expect(200);

    const invoice = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'i-1')
      .send({ fromQuoteId: quote.body.id }).expect(201);

    const detail = await request(app)
      .get(`/api/v1/invoices/${invoice.body.id}`).set(auth(provider.token)).expect(200);

    const labour = detail.body.lines.find((l: any) => l.description === 'Labour');
    expect(labour.taxTreatment).toBe('not_subject');
    expect(labour.taxReason).toBe('Labour on residential real property');
    expect(labour.lineTaxCents).toBe(0);

    // And the totals match the quote the customer accepted.
    expect(detail.body.taxCents).toBe(3300);      // 40000 * 8.25%
    expect(detail.body.totalCents).toBe(103_300);
    expect(detail.body.taxableBaseCents).toBe(40_000);
    expect(detail.body.untaxedBaseCents).toBe(60_000);
  });
});

describe('totals are server-side', () => {
  it('ignores any total a client tries to supply', async () => {
    const { provider, jobId } = await providerWithJob();
    const res = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('idempotency-key', 'k-tamper')
      .send({
        jobId,
        totalCents: 1, subtotalCents: 1, taxCents: 0,   // all ignored
        lines: [{ description: 'Work', quantity: 1, unitPriceCents: 100_000, taxRateBp: 825 }],
      })
      .expect(201);

    const quote = await request(app)
      .get(`/api/v1/quotes/${res.body.id}`).set(auth(provider.token)).expect(200);
    expect(quote.body.totalCents).toBe(108_250);
  });

  it('applies a discount to the taxable base, not to the tax afterwards', async () => {
    const { provider, jobId } = await providerWithJob();
    const res = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('idempotency-key', 'k-disc')
      .send({
        jobId,
        discountCents: 1000,
        lines: [1, 2, 3].map(() => ({
          description: 'Work', quantity: 1, unitPriceCents: 1000, taxRateBp: 825,
        })),
      })
      .expect(201);

    const quote = await request(app)
      .get(`/api/v1/quotes/${res.body.id}`).set(auth(provider.token)).expect(200);
    expect(quote.body.subtotalCents).toBe(3000);
    expect(quote.body.discountCents).toBe(1000);
    expect(quote.body.taxCents).toBe(165);   // 2000 * 8.25%
    expect(quote.body.totalCents).toBe(2165);
  });
});
