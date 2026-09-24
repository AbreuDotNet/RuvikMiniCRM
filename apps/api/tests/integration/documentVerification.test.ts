import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, publishProvider,
  drainQueue, auth,
} from '../helpers/setup.js';

let app: Express;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => { await resetDatabase(); await seedCatalogue(); });

/**
 * A provider with one client and one job, ready to raise documents against.
 * The client's contact details are distinctive so a leak is unmissable.
 */
async function bookOfWork(seed: string) {
  const provider = await registerUser(app, {
    role: 'provider', email: `${seed}@test.local`, businessName: 'Greenleaf Plumbing',
    city: 'Austin',
  });
  await publishProvider(provider.providerId!);

  const client = await request(app)
    .post('/api/v1/provider/clients').set(auth(provider.token))
    .send({
      fullName: 'Ana Reyes',
      email: `${seed}-secret-client@test.local`,
      phone: '+15125551001',
    })
    .expect(201);

  const job = await request(app)
    .post('/api/v1/provider/jobs').set(auth(provider.token))
    .send({ clientId: client.body.id, title: 'Water heater replacement' })
    .expect(201);

  return { provider, clientId: client.body.id as string, jobId: job.body.id as string };
}

const LINES = [
  { description: 'Water heater unit', quantity: 1, unitPriceCents: 120_000, taxRateBp: 825 },
];

async function invoice(seed: string, { send = true } = {}) {
  const { provider, jobId } = await bookOfWork(seed);
  const created = await request(app)
    .post('/api/v1/invoices').set(auth(provider.token)).set('idempotency-key', `${seed}-i`)
    .send({ jobId, lines: LINES })
    .expect(201);

  if (send) {
    await request(app)
      .post(`/api/v1/invoices/${created.body.id}/send`).set(auth(provider.token))
      .set('idempotency-key', `${seed}-s`).expect(200);
  }
  return { provider, id: created.body.id as string, number: created.body.number as string };
}

async function quote(seed: string, { send = true } = {}) {
  const { provider, jobId } = await bookOfWork(seed);
  const created = await request(app)
    .post('/api/v1/quotes').set(auth(provider.token)).set('idempotency-key', `${seed}-q`)
    .send({ jobId, lines: LINES })
    .expect(201);

  if (send) {
    await request(app)
      .post(`/api/v1/quotes/${created.body.id}/send`).set(auth(provider.token))
      .set('idempotency-key', `${seed}-qs`).expect(200);
  }
  return { provider, id: created.body.id as string, number: created.body.number as string };
}

const verify = (kind: string, id: string) => request(app).get(`/api/v1/verify/${kind}/${id}`);

/* ========================================================================== */
/* The link the PDF prints                                                    */
/* ========================================================================== */

describe('verifying an issued document', () => {
  it('confirms an invoice without a session', async () => {
    const { id, number } = await invoice('inv-ok');

    // No Authorization header: the holder of the paper is the audience.
    const res = await verify('invoice', id).expect(200);

    expect(res.body).toMatchObject({
      kind: 'invoice',
      number,
      status: 'sent',
      currency: 'USD',
      totalCents: 129_900,
      issuedBy: { businessName: 'Greenleaf Plumbing', city: 'Austin' },
    });
  });

  it('confirms a quote too', async () => {
    const { id, number } = await quote('q-ok');
    const res = await verify('quote', id).expect(200);
    expect(res.body).toMatchObject({ kind: 'quote', number, status: 'sent' });
  });

  it('reports the digest of the rendered PDF once the worker has run', async () => {
    const { id } = await invoice('inv-digest');

    const before = await verify('invoice', id).expect(200);
    // Rendering is queued, so the digest is honestly null rather than absent.
    expect(before.body).toHaveProperty('digest', null);

    await drainQueue();

    const after = await verify('invoice', id).expect(200);
    expect(after.body.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

/* ========================================================================== */
/* What it refuses to say                                                     */
/* ========================================================================== */

describe('what verification does not disclose', () => {
  /**
   * The response is a subset of what is printed on the document the reader is
   * already holding. Anything else would turn a courtesy into a disclosure.
   */
  it('carries no client, contact or line-item detail', async () => {
    const { id } = await invoice('inv-quiet');
    await drainQueue();

    const res = await verify('invoice', id).expect(200);
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('Ana Reyes');
    expect(body).not.toContain('secret-client');
    expect(body).not.toContain('+15125551001');
    expect(body).not.toContain('Water heater unit');
    expect(res.body).not.toHaveProperty('lines');
    expect(res.body).not.toHaveProperty('client');
    expect(res.body).not.toHaveProperty('notes');
  });

  /** A draft has never reached anybody, so nobody can be holding one. */
  it('hides a draft invoice behind the same 404 as a miss', async () => {
    const { id } = await invoice('inv-draft', { send: false });
    await verify('invoice', id).expect(404);
  });

  it('hides a draft quote as well', async () => {
    const { id } = await quote('q-draft', { send: false });
    await verify('quote', id).expect(404);
  });

  it('answers an unknown id with 404', async () => {
    await verify('invoice', '00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('refuses a kind it does not issue', async () => {
    const { id } = await invoice('inv-kind');
    await verify('receipt', id).expect(422);
  });

  it('refuses an id that is not an id', async () => {
    await verify('invoice', 'not-a-uuid').expect(422);
  });

  /**
   * An invoice id presented as a quote must not resolve. The tables are
   * separate, so this is really a check that the kind selects the table rather
   * than being decorative.
   */
  it('does not resolve an invoice id under the quote kind', async () => {
    const { id } = await invoice('inv-crosskind');
    await verify('quote', id).expect(404);
  });
});

/* ========================================================================== */
/* The country nobody chose                                                   */
/* ========================================================================== */

/**
 * Lives here rather than in its own file because it is one assertion about a
 * default, and the thing it guards is the same one this suite exists for: a
 * document that states a jurisdiction nobody picked.
 */
describe('country defaults', () => {
  it('stamps a new provider US, not DO', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'country-pro@test.local', businessName: 'Default Co',
    });

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query<{ country: string }>(
      'SELECT country FROM providers WHERE id = $1',
      [provider.providerId],
    );

    // Signup writes no country column at all, so this is purely the default.
    expect(rows[0].country).toBe('US');
  });

  it('stamps a new customer US too', async () => {
    const customer = await registerUser(app, {
      role: 'customer', email: 'country-cust@test.local',
    });

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query<{ country: string }>(
      'SELECT country FROM customer_profiles WHERE user_id = $1',
      [customer.id],
    );

    expect(rows[0].country).toBe('US');
  });
});
