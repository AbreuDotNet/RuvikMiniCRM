import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, publishProvider, drainQueue, auth,
} from '../helpers/setup.js';

let app: Express;
let categoryId: string;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => {
  await resetDatabase();
  ({ categoryId } = await seedCatalogue());
});

const db = async () => (await import('../../src/db/index.js')).getDb();

/**
 * A drywall job in Texas: materials taxable, residential labour outside the
 * tax. Built through the real endpoints so the assertions cover the whole
 * path rather than the service layer alone.
 */
async function texasJob(seed: string) {
  const provider = await registerUser(app, {
    role: 'provider', email: `${seed}@test.local`, businessName: `${seed} Drywall`,
  });
  await publishProvider(provider.providerId!);
  await request(app)
    .patch('/api/v1/provider/tax-settings').set(auth(provider.token))
    .send({ taxState: 'TX', defaultTaxRateBp: 825 }).expect(200);

  const service = await request(app)
    .post('/api/v1/provider/services').set(auth(provider.token))
    .send({
      categoryId, title: 'Drywall repair', pricingType: 'request_quote', status: 'active',
    })
    .expect(201);

  const customer = await registerUser(app, { role: 'customer', email: `${seed}c@test.local` });
  const job = await request(app)
    .post('/api/v1/customer/requests').set(auth(customer.token))
    .send({
      providerId: provider.providerId, serviceId: service.body.id,
      title: 'Ceiling repair', description: 'Water damage in the hallway ceiling.',
    })
    .expect(201);

  // The work address, which is what most states source the tax to.
  const conn = await db();
  await conn.query(
    `UPDATE jobs SET address_line = $2, city = $3, region = $4, postal_code = $5,
            completed_at = now()
      WHERE id = $1`,
    [job.body.id, '2405 East 6th Street', 'Austin', 'TX', '78702'],
  );

  return { provider, customer, jobId: job.body.id as string };
}

async function acceptedQuote(seed: string, lines: any[]) {
  const ctx = await texasJob(seed);
  const quote = await request(app)
    .post('/api/v1/quotes').set(auth(ctx.provider.token)).set('idempotency-key', `${seed}-q`)
    .send({ jobId: ctx.jobId, lines })
    .expect(201);
  await request(app)
    .post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(ctx.provider.token))
    .set('idempotency-key', `${seed}-s`).expect(200);
  await request(app)
    .post(`/api/v1/quotes/${quote.body.id}/respond`).set(auth(ctx.customer.token))
    .send({ decision: 'accept' }).expect(200);
  return { ...ctx, quoteId: quote.body.id as string };
}

const TX_LINES = [
  {
    description: 'Drywall sheets, compound and tape', quantity: 1, unitPriceCents: 48_000,
    taxRateBp: 825, taxTreatment: 'taxable', lineKind: 'materials',
  },
  {
    description: 'Installation and finishing labour', quantity: 16, unitPriceCents: 4_500,
    taxRateBp: 825, taxTreatment: 'not_subject', lineKind: 'labour',
    taxReason: 'Labour on residential real property is not subject to Texas sales tax',
  },
];

/* ========================================================================== */
/* What the document has to be able to prove                                  */
/* ========================================================================== */

describe('the evidence behind a tax treatment survives to the invoice', () => {
  it('carries materials-or-labour across from the accepted quote', async () => {
    const { provider, quoteId } = await acceptedQuote('kinds', TX_LINES);

    const invoice = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'kinds-i')
      .send({ fromQuoteId: quoteId }).expect(201);

    const conn = await db();
    const { rows } = await conn.query<any>(
      `SELECT line_kind, tax_treatment, tax_reason
         FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
      [invoice.body.id],
    );
    // Without this the invoice could state a treatment it could not justify:
    // "not subject" with nothing on the record saying it was labour.
    expect(rows.map((r: any) => r.line_kind)).toEqual(['materials', 'labour']);
    expect(rows[1].tax_treatment).toBe('not_subject');
    expect(rows[1].tax_reason).toContain('residential real property');
  });

  it('returns the line classification, not only stores it', async () => {
    const { provider, quoteId } = await acceptedQuote('api-kinds', TX_LINES);
    const created = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'api-kinds-i')
      .send({ fromQuoteId: quoteId }).expect(201);

    const invoice = await request(app)
      .get(`/api/v1/invoices/${created.body.id}`).set(auth(provider.token)).expect(200);

    // The columns were written and selected but never mapped into the
    // response, so the app and the customer's copy could not show the basis
    // of the treatment the document states. Found by running the flow.
    expect(invoice.body.lines.map((l: any) => l.lineKind)).toEqual(['materials', 'labour']);
    expect(invoice.body.lines[1].taxReason).toContain('residential real property');
  });

  it('records where the work was done, not just who was billed', async () => {
    const { provider, quoteId } = await acceptedQuote('addr', TX_LINES);

    const created = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'addr-i')
      .send({ fromQuoteId: quoteId }).expect(201);

    const invoice = await request(app)
      .get(`/api/v1/invoices/${created.body.id}`).set(auth(provider.token)).expect(200);

    // Most states source the tax to where the work was performed. An invoice
    // that shows only a billing address cannot be checked against the rate.
    expect(invoice.body.serviceAddress).toMatchObject({
      addressLine: '2405 East 6th Street', city: 'Austin', region: 'TX', postalCode: '78702',
    });
    expect(invoice.body.serviceDate).toBeTruthy();
  });

  it('keeps the work address it was issued with when the job is later edited', async () => {
    const { provider, quoteId, jobId } = await acceptedQuote('frozen', TX_LINES);
    const created = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'frozen-i')
      .send({ fromQuoteId: quoteId }).expect(201);

    const conn = await db();
    await conn.query(
      `UPDATE jobs SET region = 'NY', city = 'Brooklyn' WHERE id = $1`, [jobId],
    );

    const invoice = await request(app)
      .get(`/api/v1/invoices/${created.body.id}`).set(auth(provider.token)).expect(200);
    // An issued document must not move with the record it was drawn from.
    expect(invoice.body.serviceAddress.region).toBe('TX');
  });

  it('splits the totals into what was taxed and what was not', async () => {
    const { provider, quoteId } = await acceptedQuote('split', TX_LINES);
    const created = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'split-i')
      .send({ fromQuoteId: quoteId }).expect(201);

    expect(created.body.subtotalCents).toBe(120_000);
    expect(created.body.taxableBaseCents).toBe(48_000);
    expect(created.body.untaxedBaseCents).toBe(72_000);
    expect(created.body.taxCents).toBe(3_960);
    expect(created.body.totalCents).toBe(123_960);
  });
});

/* ========================================================================== */
/* Reasons are mandatory                                                      */
/* ========================================================================== */

describe('a line that is not taxed has to say why', () => {
  it('refuses an exempt line with no reason', async () => {
    const { provider, jobId } = await texasJob('noreason');
    await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('idempotency-key', 'nr-q')
      .send({
        jobId,
        lines: [{
          description: 'Materials', quantity: 1, unitPriceCents: 1000,
          taxRateBp: 825, taxTreatment: 'exempt',
        }],
      })
      .expect(422);
  });

  it('refuses a hand-set tax figure with no explanation', async () => {
    const { provider, jobId } = await texasJob('noadj');
    const res = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('idempotency-key', 'na-q')
      .send({
        jobId,
        lines: [{
          description: 'Work', quantity: 1, unitPriceCents: 1000,
          taxRateBp: 500, taxTreatment: 'manual_adjustment',
        }],
      })
      .expect(422);
    expect(JSON.stringify(res.body)).toMatch(/adjusted/i);
  });

  it('accepts a manual adjustment that is explained, and still charges the tax', async () => {
    const { provider, jobId } = await texasJob('adj');
    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('idempotency-key', 'adj-q')
      .send({
        jobId,
        lines: [{
          description: 'Work', quantity: 1, unitPriceCents: 20_000,
          taxRateBp: 500, taxTreatment: 'manual_adjustment',
          taxReason: 'Rate agreed with the client CPA pending a ruling',
        }],
      })
      .expect(201);
    // A manual adjustment is not relief: the tax is still charged.
    expect(quote.body.taxCents).toBe(1_000);
    expect(quote.body.taxableBaseCents).toBe(20_000);
  });

  it('carries an exemption certificate reference when a state needs one', async () => {
    const { provider, jobId } = await texasJob('cert');
    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('idempotency-key', 'cert-q')
      .send({
        jobId,
        lines: [{
          description: 'Cabinet installation', quantity: 1, unitPriceCents: 90_000,
          taxRateBp: 887, taxTreatment: 'exempt', lineKind: 'materials',
          taxReason: 'Capital improvement — certificate held',
          taxExemptionCertificate: 'ST-124 2026-0042',
        }],
      })
      .expect(201);

    const conn = await db();
    const { rows } = await conn.query<any>(
      'SELECT tax_exemption_certificate FROM quote_items WHERE quote_id = $1',
      [quote.body.id],
    );
    // New York relieves a capital improvement only when the contractor holds
    // Form ST-124 from the customer, so the reference has to be on the record.
    expect(rows[0].tax_exemption_certificate).toBe('ST-124 2026-0042');
  });
});

/* ========================================================================== */
/* Money                                                                      */
/* ========================================================================== */

describe('the money cannot be gamed from the client', () => {
  it('ignores a client-supplied total and recomputes it', async () => {
    const { provider, quoteId } = await acceptedQuote('totals', TX_LINES);
    const created = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'totals-i')
      .send({ fromQuoteId: quoteId, totalCents: 1, taxCents: 0 })
      .expect(201);
    expect(created.body.totalCents).toBe(123_960);
  });

  it('refuses a second invoice for the same accepted quote', async () => {
    const { provider, quoteId } = await acceptedQuote('dupe', TX_LINES);
    await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'dupe-1')
      .send({ fromQuoteId: quoteId }).expect(201);
    const second = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'dupe-2')
      .send({ fromQuoteId: quoteId }).expect(409);
    expect(second.body.error.message).toMatch(/already exists/i);
  });

  it('gives every invoice a unique sequential number', async () => {
    const { provider, quoteId } = await acceptedQuote('seq', TX_LINES);
    const first = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'seq-1')
      .send({ fromQuoteId: quoteId }).expect(201);
    expect(first.body.number).toMatch(/^INV-\d{4}-0001$/);

    const conn = await db();
    const { rows } = await conn.query<any>(
      'SELECT count(*)::int AS n FROM invoices WHERE number = $1', [first.body.number],
    );
    expect(rows[0].n).toBe(1);
  });

  it('refuses a payment larger than the balance', async () => {
    const { provider, quoteId } = await acceptedQuote('over', TX_LINES);
    const inv = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'over-i')
      .send({ fromQuoteId: quoteId }).expect(201);
    await request(app)
      .post(`/api/v1/invoices/${inv.body.id}/send`).set(auth(provider.token)).expect(200);

    const res = await request(app)
      .post(`/api/v1/invoices/${inv.body.id}/payments`).set(auth(provider.token))
      .set('idempotency-key', 'over-p')
      .send({ amountCents: 200_000, method: 'cash' }).expect(409);
    expect(res.body.error.details.balanceCents).toBe(123_960);
  });

  it('settles a balance across two partial payments without drift', async () => {
    const { provider, quoteId } = await acceptedQuote('partial', TX_LINES);
    const inv = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'partial-i')
      .send({ fromQuoteId: quoteId }).expect(201);
    await request(app)
      .post(`/api/v1/invoices/${inv.body.id}/send`).set(auth(provider.token)).expect(200);

    const first = await request(app)
      .post(`/api/v1/invoices/${inv.body.id}/payments`).set(auth(provider.token))
      .set('idempotency-key', 'partial-p1')
      .send({ amountCents: 61_980, method: 'transfer' }).expect(200);
    expect(first.body.status).toBe('partially_paid');
    expect(first.body.balanceCents).toBe(61_980);

    const second = await request(app)
      .post(`/api/v1/invoices/${inv.body.id}/payments`).set(auth(provider.token))
      .set('idempotency-key', 'partial-p2')
      .send({ amountCents: 61_980, method: 'cash' }).expect(200);
    expect(second.body.status).toBe('paid');
    expect(second.body.balanceCents).toBe(0);
  });
});

/* ========================================================================== */
/* Viewed                                                                     */
/* ========================================================================== */

describe('sent and viewed stop being the same thing', () => {
  async function sentInvoice(seed: string) {
    const ctx = await acceptedQuote(seed, TX_LINES);
    const inv = await request(app)
      .post('/api/v1/invoices').set(auth(ctx.provider.token)).set('idempotency-key', `${seed}-i`)
      .send({ fromQuoteId: ctx.quoteId }).expect(201);
    await request(app)
      .post(`/api/v1/invoices/${inv.body.id}/send`).set(auth(ctx.provider.token)).expect(200);
    await drainQueue();
    return { ...ctx, invoiceId: inv.body.id as string };
  }

  it('moves to viewed the first time the customer opens it', async () => {
    const { customer, provider, invoiceId } = await sentInvoice('viewed');

    const before = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`).set(auth(provider.token)).expect(200);
    // The provider opening their own invoice is not the customer reading it.
    expect(before.body.status).toBe('sent');
    expect(before.body.firstViewedAt).toBeNull();

    const seen = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`).set(auth(customer.token)).expect(200);
    expect(seen.body.status).toBe('viewed');
    expect(seen.body.firstViewedAt).toBeTruthy();
  });

  it('does not walk a paid invoice backwards when it is read again', async () => {
    const { customer, provider, invoiceId } = await sentInvoice('noback');
    await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`).set(auth(provider.token))
      .set('idempotency-key', 'noback-p')
      .send({ amountCents: 123_960, method: 'cash' }).expect(200);

    const after = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`).set(auth(customer.token)).expect(200);
    expect(after.body.status).toBe('paid');
  });

  it('still counts a viewed invoice as money outstanding', async () => {
    const { customer, provider, invoiceId } = await sentInvoice('outstanding');
    await request(app).get(`/api/v1/invoices/${invoiceId}`).set(auth(customer.token)).expect(200);

    const list = await request(app)
      .get('/api/v1/invoices').set(auth(provider.token)).expect(200);
    // The whole risk of adding a status: the money quietly leaving the total.
    expect(Number(list.body.summary.outstandingCents)).toBe(123_960);
  });

  it('still lets a viewed invoice go overdue', async () => {
    const { customer, invoiceId } = await sentInvoice('overdue');
    await request(app).get(`/api/v1/invoices/${invoiceId}`).set(auth(customer.token)).expect(200);

    const conn = await db();
    await conn.query(
      `UPDATE invoices SET due_date = CURRENT_DATE - 1 WHERE id = $1`, [invoiceId],
    );
    const { HANDLERS } = await import('../../src/workers/handlers.js');
    await HANDLERS['invoice.overdue']({});

    const { rows } = await conn.query<any>('SELECT status FROM invoices WHERE id = $1', [invoiceId]);
    expect(rows[0].status).toBe('overdue');
  });
});

/* ========================================================================== */
/* Authorisation                                                              */
/* ========================================================================== */

describe('an invoice belongs to one provider and one customer', () => {
  it('hides another provider invoice behind a 404, not a 403', async () => {
    const { provider, quoteId } = await acceptedQuote('own', TX_LINES);
    const inv = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'own-i')
      .send({ fromQuoteId: quoteId }).expect(201);

    const stranger = await registerUser(app, {
      role: 'provider', email: 'stranger@test.local', businessName: 'Stranger Co',
    });
    // 404 rather than 403: a 403 would confirm the invoice exists.
    await request(app)
      .get(`/api/v1/invoices/${inv.body.id}`).set(auth(stranger.token)).expect(404);
    await request(app)
      .post(`/api/v1/invoices/${inv.body.id}/payments`).set(auth(stranger.token))
      .set('idempotency-key', 'stranger-p')
      .send({ amountCents: 100, method: 'cash' }).expect(404);
  });

  it('hides a draft invoice from the customer until it is sent', async () => {
    const { provider, customer, quoteId } = await acceptedQuote('draft', TX_LINES);
    const inv = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'draft-i')
      .send({ fromQuoteId: quoteId }).expect(201);

    await request(app)
      .get(`/api/v1/invoices/${inv.body.id}`).set(auth(customer.token)).expect(404);
  });

  it('refuses to record a payment against a draft', async () => {
    const { provider, quoteId } = await acceptedQuote('nopay', TX_LINES);
    const inv = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'nopay-i')
      .send({ fromQuoteId: quoteId }).expect(201);

    await request(app)
      .post(`/api/v1/invoices/${inv.body.id}/payments`).set(auth(provider.token))
      .set('idempotency-key', 'nopay-p')
      .send({ amountCents: 100, method: 'cash' }).expect(409);
  });
});

/* ========================================================================== */
/* Nothing sensitive on the document                                          */
/* ========================================================================== */

describe('the document carries no taxpayer identifiers', () => {
  it('returns nothing resembling an SSN or a TIN', async () => {
    const { provider, quoteId } = await acceptedQuote('priv', TX_LINES);
    const created = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'priv-i')
      .send({ fromQuoteId: quoteId }).expect(201);

    const invoice = await request(app)
      .get(`/api/v1/invoices/${created.body.id}`).set(auth(provider.token)).expect(200);

    const body = JSON.stringify(invoice.body);
    expect(body).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);   // SSN shape
    expect(body).not.toMatch(/\b\d{2}-\d{7}\b/);          // EIN shape
    expect(body.toLowerCase()).not.toContain('"ssn"');
    expect(body.toLowerCase()).not.toContain('"tin"');
  });
});

/* ========================================================================== */
/* The state has to be enterable, not only readable                           */
/* ========================================================================== */

describe('the work address can actually be recorded', () => {
  it('keeps the state and postal code a customer sends with a request', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'reqaddr@test.local', businessName: 'Req Addr Co',
    });
    await publishProvider(provider.providerId!);
    const service = await request(app)
      .post('/api/v1/provider/services').set(auth(provider.token))
      .send({ categoryId, title: 'Repair', pricingType: 'request_quote', status: 'active' })
      .expect(201);

    const customer = await registerUser(app, { role: 'customer', email: 'reqaddrc@test.local' });
    const job = await request(app)
      .post('/api/v1/customer/requests').set(auth(customer.token))
      .send({
        providerId: provider.providerId, serviceId: service.body.id,
        title: 'Ceiling repair', description: 'Water damage in the hallway ceiling.',
        addressLine: '2405 East 6th Street', city: 'Austin', region: 'TX', postalCode: '78702',
      })
      .expect(201);

    const detail = await request(app)
      .get(`/api/v1/provider/jobs/${job.body.id}`).set(auth(provider.token)).expect(200);
    // Both schemas used to drop these silently, so no path in the product
    // could record a state — and the state is the whole basis of the
    // jurisdiction the invoice claims.
    expect(detail.body.region).toBe('TX');
    expect(detail.body.postalCode).toBe('78702');
  });

  it('keeps the state on a job the provider creates by hand', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'manualaddr@test.local', businessName: 'Manual Addr Co',
    });
    const client = await request(app)
      .post('/api/v1/provider/clients').set(auth(provider.token))
      .send({
        fullName: 'Walk-in Client', city: 'Brooklyn', region: 'NY', postalCode: '11238',
        addressLine: '590 Vanderbilt Avenue',
      })
      .expect(201);

    const job = await request(app)
      .post('/api/v1/provider/jobs').set(auth(provider.token)).set('idempotency-key', 'manual-addr')
      .send({
        clientId: client.body.id, title: 'Cabinet installation',
        addressLine: '590 Vanderbilt Avenue', city: 'Brooklyn', region: 'NY', postalCode: '11238',
      })
      .expect(201);

    const detail = await request(app)
      .get(`/api/v1/provider/jobs/${job.body.id}`).set(auth(provider.token)).expect(200);
    expect(detail.body.region).toBe('NY');
    expect(detail.body.postalCode).toBe('11238');
  });

  it('normalises the state so "tx" and "TX" are the same jurisdiction', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'lowerstate@test.local', businessName: 'Lower State Co',
    });
    const client = await request(app)
      .post('/api/v1/provider/clients').set(auth(provider.token))
      .send({ fullName: 'Case Test', region: 'tx' })
      .expect(201);

    const detail = await request(app)
      .get(`/api/v1/provider/clients/${client.body.id}`).set(auth(provider.token)).expect(200);
    expect(detail.body.region).toBe('TX');
  });
});

/* ========================================================================== */
/* A job raised by hand still reaches the customer                            */
/* ========================================================================== */

describe('a provider-raised job for an existing platform customer', () => {
  /**
   * The provider and a customer who has already engaged them through the
   * platform, which is what puts `user_id` on the client record.
   */
  async function relationship(seed: string) {
    const provider = await registerUser(app, {
      role: 'provider', email: `${seed}p@test.local`, businessName: `${seed} Co`,
    });
    await publishProvider(provider.providerId!);
    const service = await request(app)
      .post('/api/v1/provider/services').set(auth(provider.token))
      .send({ categoryId, title: 'Repair', pricingType: 'request_quote', status: 'active' })
      .expect(201);

    const customer = await registerUser(app, { role: 'customer', email: `${seed}c@test.local` });
    await request(app)
      .post('/api/v1/customer/requests').set(auth(customer.token))
      .send({
        providerId: provider.providerId, serviceId: service.body.id,
        title: 'First job', description: 'The job that started the relationship.',
      })
      .expect(201);

    const clients = await request(app)
      .get('/api/v1/provider/clients').set(auth(provider.token)).expect(200);
    const client = clients.body.data.find((c: any) => c.email === `${seed}c@test.local`);
    return { provider, customer, clientId: client.id as string };
  }

  it('links the job to their account so they can respond to a quote', async () => {
    const { provider, customer, clientId } = await relationship('link');

    const job = await request(app)
      .post('/api/v1/provider/jobs').set(auth(provider.token)).set('idempotency-key', 'link-j')
      .send({ clientId, title: 'Follow-up repair', city: 'Austin', region: 'TX' })
      .expect(201);

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('idempotency-key', 'link-q')
      .send({
        jobId: job.body.id,
        lines: [{ description: 'Work', quantity: 1, unitPriceCents: 25_000, taxRateBp: 0 }],
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token))
      .set('idempotency-key', 'link-s').expect(200);

    // This used to be a 404: the manual job carried no customer_user_id, so
    // respondToQuote could not match the customer and the quote was
    // undeliverable in the app however it looked to the provider.
    await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/respond`).set(auth(customer.token))
      .send({ decision: 'accept' }).expect(200);
  });

  it('shows the job in the customer own request list', async () => {
    const { provider, customer, clientId } = await relationship('shown');
    await request(app)
      .post('/api/v1/provider/jobs').set(auth(provider.token)).set('idempotency-key', 'shown-j')
      .send({ clientId, title: 'Gutter clearing' })
      .expect(201);

    const requests = await request(app)
      .get('/api/v1/customer/requests').set(auth(customer.token)).expect(200);
    expect(requests.body.data.some((r: any) => r.title === 'Gutter clearing')).toBe(true);
  });

  it('does not attach a walk-in client to anybody account', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'walkin@test.local', businessName: 'Walk In Co',
    });
    const client = await request(app)
      .post('/api/v1/provider/clients').set(auth(provider.token))
      .send({ fullName: 'Cash Customer', city: 'Austin', region: 'TX' })
      .expect(201);

    const job = await request(app)
      .post('/api/v1/provider/jobs').set(auth(provider.token)).set('idempotency-key', 'walkin-j')
      .send({ clientId: client.body.id, title: 'Fence repair' })
      .expect(201);

    const conn = await db();
    const { rows } = await conn.query<any>(
      'SELECT customer_user_id FROM jobs WHERE id = $1', [job.body.id],
    );
    // A client with no platform account links to nothing, which is the whole
    // reason this is safe: the provider cannot choose whose account to attach.
    expect(rows[0].customer_user_id).toBeNull();
  });

  it('gives the provider no way to set the account link themselves', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'forge@test.local', businessName: 'Forge Co',
    });
    const victim = await registerUser(app, { role: 'customer', email: 'victim@test.local' });

    const client = await request(app)
      .post('/api/v1/provider/clients').set(auth(provider.token))
      // Both spellings are dropped by the schema rather than written.
      .send({ fullName: 'Not Theirs', userId: victim.id, user_id: victim.id })
      .expect(201);

    const conn = await db();
    const { rows } = await conn.query<any>(
      'SELECT user_id FROM clients WHERE id = $1', [client.body.id],
    );
    expect(rows[0].user_id).toBeNull();
  });
});
