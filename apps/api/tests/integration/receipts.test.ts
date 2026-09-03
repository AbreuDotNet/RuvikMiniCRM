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

/** A sent invoice for $200 + 8.25% tax, ready to take payments. */
async function sentInvoice(seed: string, unitPriceCents = 20_000) {
  const provider = await registerUser(app, {
    role: 'provider', email: `${seed}@test.local`, businessName: 'Greenleaf Plumbing',
  });
  await publishProvider(provider.providerId!);
  await request(app)
    .patch('/api/v1/provider/tax-settings').set(auth(provider.token))
    .send({ taxState: 'TX', defaultTaxRateBp: 825 }).expect(200);

  const client = await request(app)
    .post('/api/v1/provider/clients').set(auth(provider.token))
    .send({ fullName: 'Ana Reyes', email: `${seed}c@test.local`, phone: '+15125551001' })
    .expect(201);
  const job = await request(app)
    .post('/api/v1/provider/jobs').set(auth(provider.token))
    .send({ clientId: client.body.id, title: 'Water heater replacement' })
    .expect(201);

  const invoice = await request(app)
    .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', `${seed}-i`)
    .send({
      jobId: job.body.id,
      lines: [
        { description: 'Water heater unit', quantity: 1, unitPriceCents, taxRateBp: 825 },
        {
          description: 'Installation labour', quantity: 2, unitPriceCents: 9_000, taxRateBp: 825,
          taxTreatment: 'not_subject', taxReason: 'Labour on residential real property',
        },
      ],
    })
    .expect(201);
  await request(app)
    .post(`/api/v1/invoices/${invoice.body.id}/send`).set(auth(provider.token))
    .set('idempotency-key', `${seed}-s`).expect(200);

  return { provider, invoiceId: invoice.body.id as string, jobId: job.body.id as string };
}

const pay = (token: string, invoiceId: string, key: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/v1/invoices/${invoiceId}/payments`).set(auth(token))
    .set('idempotency-key', key).send(body);

describe('receipt issuing', () => {
  it('issues a numbered receipt with the payment itself', async () => {
    // The number is claimed in the same transaction as the payment: a payment
    // with no receipt would leave the customer without proof.
    const { provider, invoiceId } = await sentInvoice('issue');
    const res = await pay(provider.token, invoiceId, 'i-1', { amountCents: 1000, method: 'cash' })
      .expect(200);

    expect(res.body.payment.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.payment.receiptNumber).toMatch(/^RCP-\d{4}-0001$/);
    expect(res.body.payment.method).toBe('cash');
  });

  it('numbers receipts sequentially per provider', async () => {
    const { provider, invoiceId } = await sentInvoice('seq');
    const first = await pay(provider.token, invoiceId, 's-1', { amountCents: 1000 }).expect(200);
    const second = await pay(provider.token, invoiceId, 's-2', { amountCents: 1000 }).expect(200);

    expect(first.body.payment.receiptNumber).toMatch(/-0001$/);
    expect(second.body.payment.receiptNumber).toMatch(/-0002$/);
  });

  it('gives each provider their own sequence', async () => {
    const a = await sentInvoice('provA');
    const b = await sentInvoice('provB');
    const ra = await pay(a.provider.token, a.invoiceId, 'a-1', { amountCents: 500 }).expect(200);
    const rb = await pay(b.provider.token, b.invoiceId, 'b-1', { amountCents: 500 }).expect(200);

    expect(ra.body.payment.receiptNumber).toMatch(/-0001$/);
    expect(rb.body.payment.receiptNumber).toMatch(/-0001$/);
  });
});

describe('receipt contents', () => {
  it('carries everything a printed ticket needs', async () => {
    const { provider, invoiceId } = await sentInvoice('content');
    const paid = await pay(provider.token, invoiceId, 'c-1', { amountCents: 5_000, method: 'card' })
      .expect(200);

    const r = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/receipts/${paid.body.payment.id}`)
      .set(auth(provider.token)).expect(200);

    // Business identity, so the slip stands alone.
    expect(r.body.business.name).toBe('Greenleaf Plumbing');
    // When and which.
    expect(r.body.receiptNumber).toMatch(/^RCP-/);
    expect(new Date(r.body.paidAt).getTime()).toBeGreaterThan(0);
    expect(r.body.invoice.number).toMatch(/^INV-/);
    // Who.
    expect(r.body.customerName).toBe('Ana Reyes');
    // What was bought.
    expect(r.body.lines).toHaveLength(2);
    expect(r.body.lines[0].description).toBe('Water heater unit');
    // The money, in full.
    expect(r.body.invoice.subtotalCents).toBe(38_000);
    expect(r.body.invoice.taxCents).toBe(1650);       // only the unit is taxed
    expect(r.body.invoice.totalCents).toBe(39_650);
    expect(r.body.amountPaidCents).toBe(5_000);
    expect(r.body.method).toBe('card');
  });

  it('shows the balance as it stood after each payment', async () => {
    // A reprint of the first receipt must not show today's balance: the
    // customer's copy has to keep saying what it said when it was handed over.
    const { provider, invoiceId } = await sentInvoice('balance');
    const first = await pay(provider.token, invoiceId, 'b-1', { amountCents: 10_000 }).expect(200);
    const second = await pay(provider.token, invoiceId, 'b-2', { amountCents: 20_000 }).expect(200);

    const r1 = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/receipts/${first.body.payment.id}`)
      .set(auth(provider.token)).expect(200);
    const r2 = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/receipts/${second.body.payment.id}`)
      .set(auth(provider.token)).expect(200);

    expect(r1.body.amountPaidCents).toBe(10_000);
    expect(r1.body.paidToDateCents).toBe(10_000);
    expect(r1.body.balanceCents).toBe(29_650);

    expect(r2.body.amountPaidCents).toBe(20_000);
    expect(r2.body.paidToDateCents).toBe(30_000);
    expect(r2.body.balanceCents).toBe(9_650);
  });

  it('reprints identically', async () => {
    const { provider, invoiceId } = await sentInvoice('reprint');
    const paid = await pay(provider.token, invoiceId, 'r-1', { amountCents: 1_000 }).expect(200);
    const url = `/api/v1/invoices/${invoiceId}/receipts/${paid.body.payment.id}`;

    const once = await request(app).get(url).set(auth(provider.token)).expect(200);
    await request(app).post(`${url}/printed`).set(auth(provider.token)).expect(200);
    const twice = await request(app).get(url).set(auth(provider.token)).expect(200);

    // Only the printed marker may differ; the document must not.
    const { printedAt: _a, ...first } = once.body;
    const { printedAt: _b, ...second } = twice.body;
    expect(second).toEqual(first);
  });

  it('carries the untaxed line and its reason onto the ticket', async () => {
    const { provider, invoiceId } = await sentInvoice('taxline');
    const paid = await pay(provider.token, invoiceId, 't-1', { amountCents: 1_000 }).expect(200);

    const r = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/receipts/${paid.body.payment.id}`)
      .set(auth(provider.token)).expect(200);

    const labour = r.body.lines.find((l: any) => l.description === 'Installation labour');
    expect(labour.taxTreatment).toBe('not_subject');
    expect(labour.taxReason).toContain('residential real property');
    expect(r.body.invoice.untaxedBaseCents).toBe(18_000);
  });
});

describe('receipt access', () => {
  it('lets the customer who paid read their own receipt', async () => {
    // A receipt is the customer's proof; locking them out defeats the point.
    const provider = await registerUser(app, {
      role: 'provider', email: 'acc@test.local', businessName: 'Access Co',
    });
    await publishProvider(provider.providerId!);
    const service = await request(app)
      .post('/api/v1/provider/services').set(auth(provider.token))
      .send({
        categoryId, title: 'Repair', shortDescription: 'Repair work',
        pricingType: 'request_quote', estimatedDurationMin: 60, status: 'active',
      }).expect(201);
    const customer = await registerUser(app, { role: 'customer', email: 'acccust@test.local' });
    const job = await request(app)
      .post('/api/v1/customer/requests').set(auth(customer.token))
      .send({
        providerId: provider.providerId, serviceId: service.body.id,
        title: 'Repair', description: 'Something is broken in the kitchen.',
      }).expect(201);

    const invoice = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', 'acc-i')
      .send({ jobId: job.body.id, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 5_000, taxRateBp: 0 }] })
      .expect(201);
    await request(app)
      .post(`/api/v1/invoices/${invoice.body.id}/send`).set(auth(provider.token))
      .set('idempotency-key', 'acc-s').expect(200);
    const paid = await pay(provider.token, invoice.body.id, 'acc-p', { amountCents: 5_000 })
      .expect(200);

    await request(app)
      .get(`/api/v1/invoices/${invoice.body.id}/receipts/${paid.body.payment.id}`)
      .set(auth(customer.token)).expect(200);
  });

  it('hides it from an unrelated provider behind a 404', async () => {
    const { provider, invoiceId } = await sentInvoice('priv');
    const paid = await pay(provider.token, invoiceId, 'p-1', { amountCents: 1_000 }).expect(200);

    const intruder = await registerUser(app, {
      role: 'provider', email: 'nosy@test.local', businessName: 'Nosy Co',
    });
    // 404, not 403: a 403 would confirm the receipt exists.
    await request(app)
      .get(`/api/v1/invoices/${invoiceId}/receipts/${paid.body.payment.id}`)
      .set(auth(intruder.token)).expect(404);
  });

  it('will not print a receipt for a payment on another invoice', async () => {
    const a = await sentInvoice('mixA');
    const b = await sentInvoice('mixB');
    const paidOnA = await pay(a.provider.token, a.invoiceId, 'm-1', { amountCents: 1_000 })
      .expect(200);

    await request(app)
      .get(`/api/v1/invoices/${b.invoiceId}/receipts/${paidOnA.body.payment.id}`)
      .set(auth(b.provider.token)).expect(404);
  });
});

describe('payment list', () => {
  it('exposes the id and receipt number a reprint needs', async () => {
    const { provider, invoiceId } = await sentInvoice('list');
    await pay(provider.token, invoiceId, 'l-1', { amountCents: 1_000 }).expect(200);

    const detail = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`).set(auth(provider.token)).expect(200);
    const payment = detail.body.payments[0];
    expect(payment.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payment.receiptNumber).toMatch(/^RCP-/);
    expect(payment.receiptPrintedAt).toBeNull();
  });

  it('records the first print and leaves it alone on a reprint', async () => {
    const { provider, invoiceId } = await sentInvoice('printed');
    const paid = await pay(provider.token, invoiceId, 'pr-1', { amountCents: 1_000 }).expect(200);
    const url = `/api/v1/invoices/${invoiceId}/receipts/${paid.body.payment.id}/printed`;

    await request(app).post(url).set(auth(provider.token)).expect(200);
    const first = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`).set(auth(provider.token)).expect(200);
    const stamp = first.body.payments[0].receiptPrintedAt;
    expect(stamp).toBeTruthy();

    await request(app).post(url).set(auth(provider.token)).expect(200);
    const second = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`).set(auth(provider.token)).expect(200);
    // "Did the customer get a copy" is answered once; a reprint does not
    // change the answer.
    expect(second.body.payments[0].receiptPrintedAt).toBe(stamp);
  });
});

describe('payment safety', () => {
  it('refuses to overpay', async () => {
    const { provider, invoiceId } = await sentInvoice('over');
    await pay(provider.token, invoiceId, 'o-1', { amountCents: 39_650 }).expect(200);
    await pay(provider.token, invoiceId, 'o-2', { amountCents: 100 }).expect(409);
  });

  it('does not issue a receipt number for a payment that was refused', async () => {
    // A gap in the sequence would look like a missing receipt at audit time.
    const { provider, invoiceId } = await sentInvoice('gap');
    await pay(provider.token, invoiceId, 'g-1', { amountCents: 1_000 }).expect(200);
    await pay(provider.token, invoiceId, 'g-2', { amountCents: 999_999 }).expect(409);
    const ok = await pay(provider.token, invoiceId, 'g-3', { amountCents: 1_000 }).expect(200);

    expect(ok.body.payment.receiptNumber).toMatch(/-0002$/);
  });
});
