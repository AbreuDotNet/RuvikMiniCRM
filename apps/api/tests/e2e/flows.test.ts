import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import crypto from 'node:crypto';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, createAdmin, elevateToMfa,
  publishProvider, drainQueue, auth, STRONG_PASSWORD, type TestUser,
} from '../helpers/setup.js';

let app: Express;
let categoryId: string;

beforeAll(async () => {
  app = await getTestApp();
});

beforeEach(async () => {
  await resetDatabase();
  ({ categoryId } = await seedCatalogue());
});

/** Registers a published provider with one active service listing. */
async function setupProvider(email = 'pro@test.local') {
  const provider = await registerUser(app, {
    role: 'provider', email, businessName: 'Test Plumbing Co',
  });
  await publishProvider(provider.providerId!);

  const service = await request(app)
    .post('/api/v1/provider/services')
    .set(auth(provider.token))
    .send({
      categoryId,
      title: 'Toilet repair and valve replacement',
      shortDescription: 'Same-day toilet repairs',
      pricingType: 'fixed',
      priceCents: 12000,
      estimatedDurationMin: 90,
      status: 'active',
    })
    .expect(201);

  return { provider, serviceId: service.body.id as string };
}

/* ========================================================================== */
/* Flow 1: customer registration and service search                           */
/* ========================================================================== */

describe('Flow 1 — customer registration and service search', () => {
  it('registers a customer and finds a published service by keyword', async () => {
    await setupProvider();

    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        email: 'newcustomer@test.local',
        password: STRONG_PASSWORD,
        fullName: 'New Customer',
        role: 'customer',
        city: 'Santo Domingo',
      })
      .expect(201);

    expect(signup.body.user.role).toBe('customer');
    expect(signup.body.accessToken).toBeTruthy();
    expect(signup.body.user).not.toHaveProperty('password_hash');

    const search = await request(app)
      .get('/api/v1/search/services')
      .query({ q: 'toilet', limit: 10 })
      .expect(200);

    expect(search.body.data.length).toBeGreaterThan(0);
    expect(search.body.data[0].title).toContain('Toilet');
    expect(search.body.data[0].provider.businessName).toBe('Test Plumbing Co');
  });

  it('filters by category, city and pricing type', async () => {
    await setupProvider();

    const byCategory = await request(app)
      .get('/api/v1/search/services')
      .query({ category: 'plumbing' })
      .expect(200);
    expect(byCategory.body.data.length).toBe(1);

    const byWrongCity = await request(app)
      .get('/api/v1/search/services')
      .query({ city: 'Nowhere' })
      .expect(200);
    expect(byWrongCity.body.data).toHaveLength(0);

    const byPricing = await request(app)
      .get('/api/v1/search/services')
      .query({ pricingType: 'request_quote' })
      .expect(200);
    expect(byPricing.body.data).toHaveLength(0);
  });

  it('hides unpublished providers from public search', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'hidden@test.local', businessName: 'Hidden Co',
    });
    await request(app)
      .post('/api/v1/provider/services')
      .set(auth(provider.token))
      .send({ categoryId, title: 'Secret service', pricingType: 'fixed', priceCents: 5000, status: 'active' })
      .expect(201);

    const search = await request(app).get('/api/v1/search/services').expect(200);
    expect(search.body.data).toHaveLength(0);
  });

  it('paginates with a stable cursor', async () => {
    const { provider } = await setupProvider();
    for (let i = 0; i < 4; i += 1) {
      await request(app)
        .post('/api/v1/provider/services')
        .set(auth(provider.token))
        .send({ categoryId, title: `Extra service ${i}`, pricingType: 'fixed', priceCents: 1000 + i, status: 'active' })
        .expect(201);
    }

    const first = await request(app)
      .get('/api/v1/search/services')
      .query({ limit: 2, sort: 'newest' })
      .expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.pagination.hasMore).toBe(true);

    const second = await request(app)
      .get('/api/v1/search/services')
      .query({ limit: 2, sort: 'newest', cursor: first.body.pagination.nextCursor })
      .expect(200);

    const firstIds = first.body.data.map((s: any) => s.id);
    const secondIds = second.body.data.map((s: any) => s.id);
    // Pages must not overlap.
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0);
  });
});

/* ========================================================================== */
/* Flow 2: provider onboarding and service creation                           */
/* ========================================================================== */

describe('Flow 2 — provider onboarding and service creation', () => {
  it('creates a provider profile at signup and lets it publish a listing', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'onboard@test.local', businessName: 'Onboard Electric',
    });
    expect(provider.providerId).toBeTruthy();

    const profile = await request(app)
      .get('/api/v1/provider/profile')
      .set(auth(provider.token))
      .expect(200);
    expect(profile.body.businessName).toBe('Onboard Electric');
    expect(profile.body.verificationStatus).toBe('unverified');
    expect(profile.body.isPublished).toBe(false);

    await request(app)
      .patch('/api/v1/provider/profile')
      .set(auth(provider.token))
      .send({ bio: 'We do panels and rewiring.', city: 'Santiago', isPublished: true })
      .expect(200);

    const created = await request(app)
      .post('/api/v1/provider/services')
      .set(auth(provider.token))
      .send({
        categoryId, title: 'Panel upgrade', pricingType: 'starting_at',
        priceCents: 45000, status: 'active',
      })
      .expect(201);
    expect(created.body.id).toBeTruthy();

    const list = await request(app)
      .get('/api/v1/provider/services')
      .set(auth(provider.token))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('rejects a listing whose price contradicts its pricing type', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'pricing@test.local', businessName: 'Pricing Co',
    });

    const noPrice = await request(app)
      .post('/api/v1/provider/services')
      .set(auth(provider.token))
      .send({ categoryId, title: 'Fixed with no price', pricingType: 'fixed' })
      .expect(422);
    expect(JSON.stringify(noPrice.body)).toContain('priceCents');

    await request(app)
      .post('/api/v1/provider/services')
      .set(auth(provider.token))
      .send({ categoryId, title: 'Quote with a price', pricingType: 'request_quote', priceCents: 500 })
      .expect(422);
  });

  it('enforces the plan listing limit server-side', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'limited@test.local', businessName: 'Limited Co',
    });
    // Starter allows 3 listings.
    await request(app)
      .post('/api/v1/billing/subscription')
      .set(auth(provider.token))
      .send({ planCode: 'starter' })
      .expect(201);

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    await db.query(`UPDATE subscriptions SET status = 'active' WHERE provider_id = $1`, [
      provider.providerId,
    ]);

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/api/v1/provider/services')
        .set(auth(provider.token))
        .send({ categoryId, title: `Listing ${i}`, pricingType: 'fixed', priceCents: 1000 })
        .expect(201);
    }

    const overLimit = await request(app)
      .post('/api/v1/provider/services')
      .set(auth(provider.token))
      .send({ categoryId, title: 'One too many', pricingType: 'fixed', priceCents: 1000 })
      .expect(409);
    expect(overLimit.body.error.message).toContain('3 listings');
  });
});

/* ========================================================================== */
/* Flow 3: customer quote request                                             */
/* ========================================================================== */

describe('Flow 3 — customer quote request', () => {
  it('turns a customer request into a new lead in the provider CRM', async () => {
    const { provider, serviceId } = await setupProvider();
    const customer = await registerUser(app, { role: 'customer', email: 'req@test.local' });

    const created = await request(app)
      .post('/api/v1/customer/requests')
      .set(auth(customer.token))
      .send({
        providerId: provider.providerId,
        serviceId,
        title: 'Toilet running constantly',
        description: 'The main bathroom toilet will not stop running after flushing.',
        city: 'Santo Domingo',
      })
      .expect(201);

    expect(created.body.reference).toMatch(/^JOB-\d{4}-\d{4}$/);

    const leads = await request(app)
      .get('/api/v1/provider/jobs')
      .query({ status: 'new_lead' })
      .set(auth(provider.token))
      .expect(200);

    expect(leads.body.data).toHaveLength(1);
    expect(leads.body.data[0].title).toBe('Toilet running constantly');
    expect(leads.body.data[0].client.fullName).toBe('Test Customer');

    // The provider is notified in-app.
    const notes = await request(app)
      .get('/api/v1/notifications')
      .set(auth(provider.token))
      .expect(200);
    expect(notes.body.data.some((n: any) => n.type === 'lead.new')).toBe(true);
  });

  it('refuses a request against an unpublished provider', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'unpub@test.local', businessName: 'Unpublished Co',
    });
    const customer = await registerUser(app, { role: 'customer', email: 'req2@test.local' });

    await request(app)
      .post('/api/v1/customer/requests')
      .set(auth(customer.token))
      .send({
        providerId: provider.providerId,
        title: 'Some work',
        description: 'A description that is long enough to pass validation.',
      })
      .expect(404);
  });
});

/* ========================================================================== */
/* Flow 4 + 5: provider quote creation, sending, and customer acceptance      */
/* ========================================================================== */

describe('Flows 4 & 5 — quote creation, WhatsApp send, and acceptance', () => {
  async function bookedJob() {
    const { provider, serviceId } = await setupProvider();
    const customer = await registerUser(app, { role: 'customer', email: 'quote@test.local' });

    const req = await request(app)
      .post('/api/v1/customer/requests')
      .set(auth(customer.token))
      .send({
        providerId: provider.providerId, serviceId,
        title: 'Toilet repair needed',
        description: 'Toilet runs constantly and the water bill has gone up.',
      })
      .expect(201);

    return { provider, customer, jobId: req.body.id as string };
  }

  it('creates a quote with server-computed totals', async () => {
    const { provider, jobId } = await bookedJob();

    const quote = await request(app)
      .post('/api/v1/quotes')
      .set(auth(provider.token))
      .send({
        jobId,
        lines: [
          { description: 'Valve replacement', quantity: 1, unitPriceCents: 12000, taxRateBp: 1800 },
          { description: 'Labour', quantity: 1.5, unitPriceCents: 4500, taxRateBp: 1800 },
        ],
        validUntil: '2026-12-31',
      })
      .expect(201);

    expect(quote.body.number).toMatch(/^Q-\d{4}-\d{4}$/);
    expect(quote.body.subtotalCents).toBe(18750);
    expect(quote.body.taxCents).toBe(3375);
    expect(quote.body.totalCents).toBe(22125);
  });

  it('ignores a client-supplied total and recomputes from the line items', async () => {
    const { provider, jobId } = await bookedJob();

    const quote = await request(app)
      .post('/api/v1/quotes')
      .set(auth(provider.token))
      .send({
        jobId,
        lines: [{ description: 'Work', quantity: 1, unitPriceCents: 50000, taxRateBp: 0 }],
        // A tampered payload trying to under-bill.
        totalCents: 1,
        subtotalCents: 1,
      })
      .expect(201);

    expect(quote.body.totalCents).toBe(50000);
  });

  it('sends the quote, renders a PDF, and notifies the customer', async () => {
    const { provider, customer, jobId } = await bookedJob();

    const quote = await request(app)
      .post('/api/v1/quotes')
      .set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 20000, taxRateBp: 1800 }] })
      .expect(201);

    await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/send`)
      .set(auth(provider.token))
      .expect(200);

    await drainQueue();

    const view = await request(app)
      .get(`/api/v1/quotes/${quote.body.id}`)
      .set(auth(customer.token))
      .expect(200);

    expect(view.body.status).toBe('sent');
    expect(view.body.pdfUrl).toContain('/api/v1/files/download');
    expect(view.body.pdfSha256).toMatch(/^[0-9a-f]{64}$/);

    const notes = await request(app)
      .get('/api/v1/notifications')
      .set(auth(customer.token))
      .expect(200);
    expect(notes.body.data.some((n: any) => n.type === 'quote.received')).toBe(true);

    // The job advanced to "quoted".
    const job = await request(app)
      .get(`/api/v1/provider/jobs/${jobId}`)
      .set(auth(provider.token))
      .expect(200);
    expect(job.body.status).toBe('quoted');
  });

  it('skips WhatsApp when the customer has not opted in, and logs why', async () => {
    const { provider, customer, jobId } = await bookedJob();

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 10000, taxRateBp: 0 }] })
      .expect(201);
    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token)).expect(200);
    await drainQueue();

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT status FROM whatsapp_messages WHERE related_id = $1`,
      [quote.body.id],
    );
    expect(rows[0]?.status).toBe('skipped_no_consent');

    // The in-app notification is the documented fallback.
    const notes = await request(app).get('/api/v1/notifications').set(auth(customer.token)).expect(200);
    expect(notes.body.data.some((n: any) => n.type === 'quote.received')).toBe(true);
  });

  it('sends over WhatsApp once the customer has opted in', async () => {
    const { provider, customer, jobId } = await bookedJob();

    await request(app)
      .post('/api/v1/account/whatsapp-consent')
      .set(auth(customer.token))
      .send({ phone: '+18095551234', acknowledged: true })
      .expect(200);

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 10000, taxRateBp: 0 }] })
      .expect(201);
    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token)).expect(200);
    await drainQueue();

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT status, to_phone_masked, template_name FROM whatsapp_messages WHERE related_id = $1`,
      [quote.body.id],
    );
    expect(rows[0].status).toBe('sent');
    expect(rows[0].template_name).toBe('ruvik_quote_ready');
    // The log stores a masked number, never the full one.
    expect(rows[0].to_phone_masked).not.toContain('5551234');
  });

  it('lets the customer accept, which approves the job', async () => {
    const { provider, customer, jobId } = await bookedJob();

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 20000, taxRateBp: 0 }] })
      .expect(201);
    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token)).expect(200);

    const accepted = await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/respond`)
      .set(auth(customer.token))
      .send({ decision: 'accept' })
      .expect(200);
    expect(accepted.body.status).toBe('accepted');

    const job = await request(app)
      .get(`/api/v1/provider/jobs/${jobId}`)
      .set(auth(provider.token))
      .expect(200);
    expect(job.body.status).toBe('approved');
  });

  it('refuses a second response to the same quote', async () => {
    const { provider, customer, jobId } = await bookedJob();
    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 20000, taxRateBp: 0 }] })
      .expect(201);
    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token)).expect(200);

    await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/respond`)
      .set(auth(customer.token)).send({ decision: 'accept' }).expect(200);

    await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/respond`)
      .set(auth(customer.token)).send({ decision: 'decline' }).expect(409);
  });

  it('hides a draft quote from the customer until it is sent', async () => {
    const { provider, customer, jobId } = await bookedJob();
    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 20000, taxRateBp: 0 }] })
      .expect(201);

    await request(app).get(`/api/v1/quotes/${quote.body.id}`).set(auth(customer.token)).expect(404);
    await request(app).get(`/api/v1/quotes/${quote.body.id}`).set(auth(provider.token)).expect(200);
  });

  it('freezes a quote once sent', async () => {
    const { provider, jobId } = await bookedJob();
    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 20000, taxRateBp: 0 }] })
      .expect(201);
    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token)).expect(200);

    await request(app)
      .patch(`/api/v1/quotes/${quote.body.id}`)
      .set(auth(provider.token))
      .send({ lines: [{ description: 'Cheaper', quantity: 1, unitPriceCents: 1, taxRateBp: 0 }] })
      .expect(409);
  });
});

/* ========================================================================== */
/* Flow 6: job completion and invoice creation                                */
/* ========================================================================== */

describe('Flow 6 — job completion, invoicing and review', () => {
  async function acceptedQuote() {
    const { provider, serviceId } = await setupProvider();
    const customer = await registerUser(app, { role: 'customer', email: 'invoice@test.local' });

    const req = await request(app)
      .post('/api/v1/customer/requests').set(auth(customer.token))
      .send({
        providerId: provider.providerId, serviceId,
        title: 'Toilet repair', description: 'Toilet runs constantly and needs a new valve.',
      })
      .expect(201);
    const jobId = req.body.id as string;

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Valve replacement', quantity: 1, unitPriceCents: 12000, taxRateBp: 1800 }] })
      .expect(201);
    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token)).expect(200);
    await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/respond`)
      .set(auth(customer.token)).send({ decision: 'accept' }).expect(200);

    return { provider, customer, jobId, quoteId: quote.body.id as string };
  }

  it('walks the job to completion and invoices from the accepted quote', async () => {
    const { provider, customer, jobId, quoteId } = await acceptedQuote();

    for (const status of ['scheduled', 'in_progress', 'completed'] as const) {
      await request(app)
        .post(`/api/v1/provider/jobs/${jobId}/status`)
        .set(auth(provider.token))
        .send({ status, scheduledStart: status === 'scheduled' ? new Date().toISOString() : undefined })
        .expect(200);
    }

    const invoice = await request(app)
      .post('/api/v1/invoices')
      .set(auth(provider.token))
      .send({ fromQuoteId: quoteId, dueDate: '2026-12-31' })
      .expect(201);

    expect(invoice.body.number).toMatch(/^INV-\d{4}-\d{4}$/);
    // The invoice inherits the accepted quote's figures exactly.
    expect(invoice.body.totalCents).toBe(14160);

    await request(app)
      .post(`/api/v1/invoices/${invoice.body.id}/send`)
      .set(auth(provider.token)).expect(200);
    await drainQueue();

    const view = await request(app)
      .get(`/api/v1/invoices/${invoice.body.id}`)
      .set(auth(customer.token)).expect(200);
    expect(view.body.status).toBe('sent');
    expect(view.body.pdfUrl).toContain('/api/v1/files/download');

    const payment = await request(app)
      .post(`/api/v1/invoices/${invoice.body.id}/payments`)
      .set(auth(provider.token))
      .send({ amountCents: 14160, method: 'transfer' })
      .expect(200);
    expect(payment.body.status).toBe('paid');
    expect(payment.body.balanceCents).toBe(0);
  });

  it('refuses to invoice a quote the customer never accepted', async () => {
    const { provider, serviceId } = await setupProvider();
    const customer = await registerUser(app, { role: 'customer', email: 'unaccepted@test.local' });
    const req = await request(app)
      .post('/api/v1/customer/requests').set(auth(customer.token))
      .send({ providerId: provider.providerId, serviceId, title: 'Work', description: 'A sufficiently long description.' })
      .expect(201);
    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId: req.body.id, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 5000, taxRateBp: 0 }] })
      .expect(201);

    await request(app)
      .post('/api/v1/invoices').set(auth(provider.token))
      .send({ fromQuoteId: quote.body.id })
      .expect(409);
  });

  it('rejects an overpayment', async () => {
    const { provider, quoteId } = await acceptedQuote();
    const invoice = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token))
      .send({ fromQuoteId: quoteId }).expect(201);
    await request(app).post(`/api/v1/invoices/${invoice.body.id}/send`).set(auth(provider.token)).expect(200);

    await request(app)
      .post(`/api/v1/invoices/${invoice.body.id}/payments`)
      .set(auth(provider.token))
      .send({ amountCents: 999_999 })
      .expect(409);
  });

  it('handles a partial payment then settles the balance', async () => {
    const { provider, quoteId } = await acceptedQuote();
    const invoice = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token))
      .send({ fromQuoteId: quoteId }).expect(201);
    await request(app).post(`/api/v1/invoices/${invoice.body.id}/send`).set(auth(provider.token)).expect(200);

    const partial = await request(app)
      .post(`/api/v1/invoices/${invoice.body.id}/payments`)
      .set(auth(provider.token)).send({ amountCents: 5000 }).expect(200);
    expect(partial.body.status).toBe('partially_paid');
    expect(partial.body.balanceCents).toBe(9160);

    const final = await request(app)
      .post(`/api/v1/invoices/${invoice.body.id}/payments`)
      .set(auth(provider.token)).send({ amountCents: 9160 }).expect(200);
    expect(final.body.status).toBe('paid');
  });

  it('allows a review only after completion, and once only', async () => {
    const { provider, customer, jobId } = await acceptedQuote();

    // Not completed yet.
    await request(app)
      .post(`/api/v1/customer/requests/${jobId}/review`)
      .set(auth(customer.token)).send({ rating: 5 }).expect(409);

    for (const status of ['scheduled', 'in_progress', 'completed'] as const) {
      await request(app)
        .post(`/api/v1/provider/jobs/${jobId}/status`)
        .set(auth(provider.token)).send({ status }).expect(200);
    }

    await request(app)
      .post(`/api/v1/customer/requests/${jobId}/review`)
      .set(auth(customer.token))
      .send({ rating: 5, comment: 'Excellent work, arrived on time.' })
      .expect(201);

    // Second attempt is refused.
    await request(app)
      .post(`/api/v1/customer/requests/${jobId}/review`)
      .set(auth(customer.token)).send({ rating: 1 }).expect(409);

    const profile = await request(app)
      .get('/api/v1/providers/test-plumbing-co')
      .expect(200);
    expect(profile.body.ratingAvg).toBe(5);
    expect(profile.body.ratingCount).toBe(1);
  });

  it('refuses an out-of-order status transition', async () => {
    const { provider, jobId } = await acceptedQuote();
    const res = await request(app)
      .post(`/api/v1/provider/jobs/${jobId}/status`)
      .set(auth(provider.token))
      .send({ status: 'new_lead' })
      .expect(409);
    expect(res.body.error.details.allowed).toBeDefined();
  });
});

/* ========================================================================== */
/* Flow 7: subscription payment and renewal                                   */
/* ========================================================================== */

describe('Flow 7 — subscription payment and renewal', () => {
  function signBilling(body: string): string {
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto
      .createHmac('sha256', process.env.BILLING_WEBHOOK_SECRET!)
      .update(`${t}.${body}`)
      .digest('hex');
    return `t=${t},v1=${v1}`;
  }

  it('activates only after the signed webhook confirms payment', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'sub@test.local', businessName: 'Sub Co',
    });

    const checkout = await request(app)
      .post('/api/v1/billing/subscription')
      .set(auth(provider.token))
      .send({ planCode: 'pro' })
      .expect(201);

    expect(checkout.body.status).toBe('pending_payment');
    const reference = checkout.body.checkout.reference;

    // Still pending before the webhook arrives.
    const before = await request(app)
      .get('/api/v1/billing/subscription').set(auth(provider.token)).expect(200);
    expect(before.body.subscription.status).toBe('pending_payment');

    const payload = JSON.stringify({
      id: 'evt_test_1', type: 'payment.succeeded',
      data: { reference, amountCents: 2900 },
    });
    await request(app)
      .post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('X-Ruvik-Signature', signBilling(payload))
      .send(payload)
      .expect(200);

    const after = await request(app)
      .get('/api/v1/billing/subscription').set(auth(provider.token)).expect(200);
    expect(after.body.subscription.status).toBe('active');
    expect(after.body.subscription.currentPeriodEnd).toBeTruthy();
  });

  it('is idempotent against a replayed webhook', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'replay@test.local', businessName: 'Replay Co',
    });
    const checkout = await request(app)
      .post('/api/v1/billing/subscription').set(auth(provider.token))
      .send({ planCode: 'pro' }).expect(201);

    const payload = JSON.stringify({
      id: 'evt_replay_1', type: 'payment.succeeded',
      data: { reference: checkout.body.checkout.reference, amountCents: 2900 },
    });
    const sig = signBilling(payload);

    await request(app).post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json').set('X-Ruvik-Signature', sig)
      .send(payload).expect(200);

    const second = await request(app).post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json').set('X-Ruvik-Signature', sig)
      .send(payload).expect(200);
    expect(second.body.duplicate).toBe(true);

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text FROM payments WHERE subscription_id =
         (SELECT id FROM subscriptions WHERE provider_id = $1) AND status = 'succeeded'`,
      [provider.providerId],
    );
    // Exactly one successful payment, not two.
    expect(Number(rows[0].count)).toBe(1);
  });

  it('marks the subscription past_due when payment fails', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'failpay@test.local', businessName: 'Fail Co',
    });
    const checkout = await request(app)
      .post('/api/v1/billing/subscription').set(auth(provider.token))
      .send({ planCode: 'pro' }).expect(201);

    const payload = JSON.stringify({
      id: 'evt_fail_1', type: 'payment.failed',
      data: { reference: checkout.body.checkout.reference, reason: 'card_declined' },
    });
    await request(app).post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json').set('X-Ruvik-Signature', signBilling(payload))
      .send(payload).expect(200);

    const sub = await request(app)
      .get('/api/v1/billing/subscription').set(auth(provider.token)).expect(200);
    expect(sub.body.subscription.status).toBe('past_due');
  });

  it('refuses to activate when the amount paid is short of the plan price', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'short@test.local', businessName: 'Short Co',
    });
    const checkout = await request(app)
      .post('/api/v1/billing/subscription').set(auth(provider.token))
      .send({ planCode: 'pro' }).expect(201);

    const payload = JSON.stringify({
      id: 'evt_short_1', type: 'payment.succeeded',
      data: { reference: checkout.body.checkout.reference, amountCents: 1 },
    });
    await request(app).post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json').set('X-Ruvik-Signature', signBilling(payload))
      .send(payload).expect(409);

    const sub = await request(app)
      .get('/api/v1/billing/subscription').set(auth(provider.token)).expect(200);
    expect(sub.body.subscription.status).toBe('pending_payment');
  });
});

/* ========================================================================== */
/* Flow 8: admin moderation and suspension                                    */
/* ========================================================================== */

describe('Flow 8 — admin moderation and suspension', () => {
  it('verifies a provider and records the action in the audit log', async () => {
    const admin = await createAdmin(app);
    const mfaToken = await elevateToMfa(admin);
    const provider = await registerUser(app, {
      role: 'provider', email: 'verifyme@test.local', businessName: 'Verify Co',
    });

    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/verification`)
      .set(auth(mfaToken))
      .send({ status: 'verified', note: 'Licence and insurance checked.' })
      .expect(200);

    const profile = await request(app)
      .get('/api/v1/provider/profile').set(auth(provider.token)).expect(200);
    expect(profile.body.verificationStatus).toBe('verified');

    const logs = await request(app)
      .get('/api/v1/admin/audit-logs')
      .query({ action: 'admin.provider_verification' })
      .set(auth(admin.token)).expect(200);
    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0].actorUserId).toBe(admin.id);
  });

  it('suspends a provider, revokes its sessions and unpublishes it', async () => {
    const admin = await createAdmin(app);
    const mfaToken = await elevateToMfa(admin);
    const { provider } = await setupProvider('suspendme@test.local');

    // Visible before suspension.
    const before = await request(app).get('/api/v1/search/services').expect(200);
    expect(before.body.data.length).toBe(1);

    await request(app)
      .post(`/api/v1/admin/users/${provider.id}/status`)
      .set(auth(mfaToken))
      .send({ status: 'suspended', reason: 'Repeated policy violations.' })
      .expect(200);

    // The existing access token stops working immediately.
    await request(app)
      .get('/api/v1/provider/profile').set(auth(provider.token)).expect(403);

    // And the refresh token cannot mint a new one.
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: provider.refreshToken })
      .expect(401);

    const after = await request(app).get('/api/v1/search/services').expect(200);
    expect(after.body.data).toHaveLength(0);
  });

  it('removes a review and recomputes the provider rating', async () => {
    const admin = await createAdmin(app);
    const mfaToken = await elevateToMfa(admin);
    const { provider, serviceId } = await setupProvider('reviewed@test.local');
    const customer = await registerUser(app, { role: 'customer', email: 'reviewer@test.local' });

    const req = await request(app)
      .post('/api/v1/customer/requests').set(auth(customer.token))
      .send({ providerId: provider.providerId, serviceId, title: 'Work', description: 'A long enough description here.' })
      .expect(201);

    for (const status of ['contacted', 'approved', 'scheduled', 'in_progress', 'completed'] as const) {
      await request(app)
        .post(`/api/v1/provider/jobs/${req.body.id}/status`)
        .set(auth(provider.token)).send({ status }).expect(200);
    }
    await request(app)
      .post(`/api/v1/customer/requests/${req.body.id}/review`)
      .set(auth(customer.token)).send({ rating: 1, comment: 'Unfair and abusive review.' }).expect(201);

    const list = await request(app)
      .get('/api/v1/admin/reviews').set(auth(admin.token)).expect(200);
    expect(list.body.data).toHaveLength(1);

    await request(app)
      .post(`/api/v1/admin/reviews/${list.body.data[0].id}/moderate`)
      .set(auth(mfaToken))
      .send({ status: 'removed', note: 'Violates review policy.' })
      .expect(200);

    const profile = await request(app)
      .get(`/api/v1/providers/${provider.providerId}`).expect(200);
    expect(profile.body.ratingCount).toBe(0);
    expect(profile.body.ratingAvg).toBe(0);
  });

  it('keeps the audit chain verifiable after a run of actions', async () => {
    const admin = await createAdmin(app);
    const mfaToken = await elevateToMfa(admin);
    const provider = await registerUser(app, {
      role: 'provider', email: 'chain@test.local', businessName: 'Chain Co',
    });

    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/verification`)
      .set(auth(mfaToken)).send({ status: 'verified' }).expect(200);

    const integrity = await request(app)
      .get('/api/v1/admin/audit-logs/integrity').set(auth(mfaToken)).expect(200);
    expect(integrity.body.ok).toBe(true);
  });

  it('detects a tampered audit row', async () => {
    const admin = await createAdmin(app);
    const mfaToken = await elevateToMfa(admin);
    await registerUser(app, { role: 'customer', email: 'audited@test.local' });

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    // Simulate an attacker editing history directly in the database.
    await db.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = (SELECT min(id) FROM audit_logs)`);

    const integrity = await request(app)
      .get('/api/v1/admin/audit-logs/integrity').set(auth(mfaToken)).expect(200);
    expect(integrity.body.ok).toBe(false);
    expect(integrity.body.brokenAtId).toBeTruthy();
  });
});
