import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, createAdmin, elevateToMfa,
  publishProvider, auth, STRONG_PASSWORD,
} from '../helpers/setup.js';

let app: Express;
let categoryId: string;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => {
  await resetDatabase();
  ({ categoryId } = await seedCatalogue());
});

/** Two providers, each with their own client, job and quote. */
async function twoTenants() {
  const a = await registerUser(app, { role: 'provider', email: 'tenant-a@test.local', businessName: 'Tenant A' });
  const b = await registerUser(app, { role: 'provider', email: 'tenant-b@test.local', businessName: 'Tenant B' });
  await publishProvider(a.providerId!);
  await publishProvider(b.providerId!);

  const makeWork = async (provider: typeof a, label: string) => {
    const client = await request(app)
      .post('/api/v1/provider/clients').set(auth(provider.token))
      .send({ fullName: `${label} Client` }).expect(201);

    const job = await request(app)
      .post('/api/v1/provider/jobs').set(auth(provider.token))
      .send({ clientId: client.body.id, title: `${label} Job` }).expect(201);

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId: job.body.id, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 10000, taxRateBp: 0 }] })
      .expect(201);

    const invoice = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token))
      .send({ clientId: client.body.id, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 10000, taxRateBp: 0 }] })
      .expect(201);

    return { clientId: client.body.id, jobId: job.body.id, quoteId: quote.body.id, invoiceId: invoice.body.id };
  };

  return { a, b, aWork: await makeWork(a, 'A'), bWork: await makeWork(b, 'B') };
}

describe('IDOR / BOLA — cross-tenant object access', () => {
  it('does not leak another provider\'s client', async () => {
    const { b, aWork } = await twoTenants();
    await request(app)
      .get(`/api/v1/provider/clients/${aWork.clientId}`)
      .set(auth(b.token))
      .expect(404);
  });

  it('does not leak another provider\'s job', async () => {
    const { b, aWork } = await twoTenants();
    await request(app).get(`/api/v1/provider/jobs/${aWork.jobId}`).set(auth(b.token)).expect(404);
  });

  it('does not leak another provider\'s quote or invoice', async () => {
    const { b, aWork } = await twoTenants();
    await request(app).get(`/api/v1/quotes/${aWork.quoteId}`).set(auth(b.token)).expect(404);
    await request(app).get(`/api/v1/invoices/${aWork.invoiceId}`).set(auth(b.token)).expect(404);
  });

  it('answers 404 rather than 403, so ids cannot be probed for existence', async () => {
    const { b, aWork } = await twoTenants();
    const real = await request(app).get(`/api/v1/quotes/${aWork.quoteId}`).set(auth(b.token));
    const fake = await request(app)
      .get('/api/v1/quotes/00000000-0000-4000-8000-000000000000').set(auth(b.token));
    expect(real.status).toBe(fake.status);
    expect(real.body.error.message).toBe(fake.body.error.message);
  });

  it('refuses to mutate another provider\'s job', async () => {
    const { b, aWork } = await twoTenants();
    await request(app)
      .post(`/api/v1/provider/jobs/${aWork.jobId}/status`)
      .set(auth(b.token)).send({ status: 'cancelled' }).expect(404);
  });

  it('refuses to send another provider\'s quote', async () => {
    const { b, aWork } = await twoTenants();
    await request(app).post(`/api/v1/quotes/${aWork.quoteId}/send`).set(auth(b.token)).expect(404);
  });

  it('refuses to record a payment on another provider\'s invoice', async () => {
    const { b, aWork } = await twoTenants();
    await request(app)
      .post(`/api/v1/invoices/${aWork.invoiceId}/payments`)
      .set(auth(b.token)).send({ amountCents: 100 }).expect(404);
  });

  it('refuses to attach a job to a client owned by another tenant', async () => {
    const { b, aWork } = await twoTenants();
    await request(app)
      .post('/api/v1/provider/jobs').set(auth(b.token))
      .send({ clientId: aWork.clientId, title: 'Stolen client job' })
      .expect(404);
  });

  it('scopes list endpoints to the caller\'s own tenant', async () => {
    const { b } = await twoTenants();
    const clients = await request(app).get('/api/v1/provider/clients').set(auth(b.token)).expect(200);
    expect(clients.body.data).toHaveLength(1);
    expect(clients.body.data[0].fullName).toBe('B Client');

    const quotes = await request(app).get('/api/v1/quotes').set(auth(b.token)).expect(200);
    expect(quotes.body.data).toHaveLength(1);
  });

  it('stops a customer reading a quote addressed to someone else', async () => {
    const { a } = await twoTenants();
    const victim = await registerUser(app, { role: 'customer', email: 'victim@test.local' });
    const attacker = await registerUser(app, { role: 'customer', email: 'attacker@test.local' });

    const req = await request(app)
      .post('/api/v1/customer/requests').set(auth(victim.token))
      .send({ providerId: a.providerId, title: 'Private job', description: 'A confidential description here.' })
      .expect(201);

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(a.token))
      .send({ jobId: req.body.id, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 5000, taxRateBp: 0 }] })
      .expect(201);
    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(a.token)).expect(200);

    await request(app).get(`/api/v1/quotes/${quote.body.id}`).set(auth(attacker.token)).expect(404);
    await request(app)
      .post(`/api/v1/quotes/${quote.body.id}/respond`)
      .set(auth(attacker.token)).send({ decision: 'accept' }).expect(404);

    // The rightful recipient still can.
    await request(app).get(`/api/v1/quotes/${quote.body.id}`).set(auth(victim.token)).expect(200);
  });

  it('does not expose internal provider notes to the customer', async () => {
    const { a } = await twoTenants();
    const customer = await registerUser(app, { role: 'customer', email: 'noteseer@test.local' });
    const req = await request(app)
      .post('/api/v1/customer/requests').set(auth(customer.token))
      .send({ providerId: a.providerId, title: 'Job', description: 'A sufficiently long description here.' })
      .expect(201);

    await request(app)
      .post(`/api/v1/provider/jobs/${req.body.id}/notes`).set(auth(a.token))
      .send({ body: 'INTERNAL: customer haggles, quote high.', visibility: 'internal' }).expect(201);
    await request(app)
      .post(`/api/v1/provider/jobs/${req.body.id}/notes`).set(auth(a.token))
      .send({ body: 'We will arrive at 9am.', visibility: 'customer' }).expect(201);

    const view = await request(app)
      .get(`/api/v1/customer/requests/${req.body.id}`).set(auth(customer.token)).expect(200);

    const bodies = view.body.comments.map((c: any) => c.body).join(' ');
    expect(bodies).toContain('9am');
    expect(JSON.stringify(view.body)).not.toContain('INTERNAL');
  });
});

describe('broken access control — role boundaries', () => {
  it('refuses provider endpoints to a customer', async () => {
    const customer = await registerUser(app, { role: 'customer', email: 'cust-role@test.local' });
    await request(app).get('/api/v1/provider/profile').set(auth(customer.token)).expect(403);
    await request(app).get('/api/v1/provider/dashboard').set(auth(customer.token)).expect(403);
    await request(app).get('/api/v1/quotes').set(auth(customer.token)).expect(403);
  });

  it('refuses admin endpoints to a provider and a customer', async () => {
    const provider = await registerUser(app, { role: 'provider', email: 'p-role@test.local', businessName: 'Provider One' });
    const customer = await registerUser(app, { role: 'customer', email: 'c-role@test.local' });
    for (const token of [provider.token, customer.token]) {
      await request(app).get('/api/v1/admin/metrics').set(auth(token)).expect(403);
      await request(app).get('/api/v1/admin/users').set(auth(token)).expect(403);
    }
  });

  it('refuses customer endpoints to a provider', async () => {
    const provider = await registerUser(app, { role: 'provider', email: 'p2-role@test.local', businessName: 'Provider Two' });
    await request(app).get('/api/v1/customer/requests').set(auth(provider.token)).expect(403);
  });

  it('requires MFA for admin state changes even with a valid admin token', async () => {
    const admin = await createAdmin(app);
    const victim = await registerUser(app, { role: 'customer', email: 'target@test.local' });

    // Read is allowed at aal1.
    await request(app).get('/api/v1/admin/users').set(auth(admin.token)).expect(200);

    // Suspension is not.
    await request(app)
      .post(`/api/v1/admin/users/${victim.id}/status`)
      .set(auth(admin.token)).send({ status: 'suspended', reason: 'test' }).expect(403);

    const mfaToken = await elevateToMfa(admin);
    await request(app)
      .post(`/api/v1/admin/users/${victim.id}/status`)
      .set(auth(mfaToken)).send({ status: 'suspended', reason: 'test' }).expect(200);
  });

  it('stops an admin from suspending their own account', async () => {
    const admin = await createAdmin(app);
    const mfaToken = await elevateToMfa(admin);
    await request(app)
      .post(`/api/v1/admin/users/${admin.id}/status`)
      .set(auth(mfaToken)).send({ status: 'suspended', reason: 'oops' }).expect(400);
  });

  it('rejects requests with no token, a garbage token, or the "none" algorithm', async () => {
    await request(app).get('/api/v1/provider/profile').expect(401);
    await request(app).get('/api/v1/provider/profile').set(auth('not-a-token')).expect(401);

    // alg:none forgery attempt.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: '00000000-0000-4000-8000-000000000000', role: 'admin', aal: 'mfa',
      iss: 'ruvik', aud: 'ruvik-api', exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    await request(app).get('/api/v1/admin/metrics').set(auth(`${header}.${payload}.`)).expect(401);
  });
});

describe('mass assignment', () => {
  it('ignores a role escalation attempt at signup', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        email: 'escalate@test.local', password: STRONG_PASSWORD,
        fullName: 'Sneaky', role: 'customer',
        // Extra fields the schema does not declare.
        status: 'active', mfa_enabled: true, id: '00000000-0000-4000-8000-000000000000',
      })
      .expect(201);
    expect(res.body.user.role).toBe('customer');
    expect(res.body.user.id).not.toBe('00000000-0000-4000-8000-000000000000');
  });

  it('ignores self-verification and rating tampering on the provider profile', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'selfverify@test.local', businessName: 'Self Verify Co',
    });

    await request(app)
      .patch('/api/v1/provider/profile').set(auth(provider.token))
      .send({
        bio: 'Legit bio.',
        verificationStatus: 'verified',
        verification_status: 'verified',
        ratingAvg: 5, rating_avg: 5, rating_count: 999,
        completed_jobs: 500,
      })
      .expect(200);

    const profile = await request(app)
      .get('/api/v1/provider/profile').set(auth(provider.token)).expect(200);
    expect(profile.body.verificationStatus).toBe('unverified');
    expect(profile.body.ratingAvg).toBe(0);
    expect(profile.body.ratingCount).toBe(0);
    expect(profile.body.bio).toBe('Legit bio.');
  });

  it('ignores a forged provider_id on a quote', async () => {
    const { a, b, bWork } = await twoTenants();
    // A tries to create a quote against B's job by naming B's provider id.
    await request(app)
      .post('/api/v1/quotes').set(auth(a.token))
      .send({
        jobId: bWork.jobId,
        providerId: b.providerId,
        provider_id: b.providerId,
        lines: [{ description: 'Work', quantity: 1, unitPriceCents: 100, taxRateBp: 0 }],
      })
      .expect(404);
  });
});
