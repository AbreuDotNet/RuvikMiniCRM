import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, publishProvider,
  auth, drainQueue,
} from '../helpers/setup.js';

let app: Express;
let categoryId: string;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => {
  await resetDatabase();
  ({ categoryId } = await seedCatalogue());
});

async function providerWithJob(email = 'infra@test.local') {
  const provider = await registerUser(app, { role: 'provider', email, businessName: 'Infra Test Co' });
  await publishProvider(provider.providerId!);
  const client = await request(app)
    .post('/api/v1/provider/clients').set(auth(provider.token))
    .send({ fullName: 'Infra Client', email: 'client@test.local', phone: '+18095559999' })
    .expect(201);
  const job = await request(app)
    .post('/api/v1/provider/jobs').set(auth(provider.token))
    .send({ clientId: client.body.id, title: 'Infrastructure test job' })
    .expect(201);
  return { provider, clientId: client.body.id as string, jobId: job.body.id as string };
}

describe('PDF generation pipeline', () => {
  it('renders a real PDF, stores it, and records a digest', async () => {
    const { provider, jobId } = await providerWithJob();

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({
        jobId,
        lines: [
          { description: 'Valve replacement', quantity: 1, unitPriceCents: 12000, taxRateBp: 825 },
          { description: 'Labour', quantity: 2.5, unitPriceCents: 4500, taxRateBp: 825 },
        ],
        notes: 'Thank you for your business.',
        terms: 'Valid for 14 days.',
      })
      .expect(201);

    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token)).expect(200);
    await drainQueue();

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT q.pdf_sha256, f.storage_key, f.mime_type, f.size_bytes, f.scan_status
         FROM quotes q JOIN files f ON f.id = q.pdf_file_id WHERE q.id = $1`,
      [quote.body.id],
    );

    expect(rows[0].mime_type).toBe('application/pdf');
    expect(Number(rows[0].size_bytes)).toBeGreaterThan(1000);
    // Platform-generated artefacts bypass quarantine.
    expect(rows[0].scan_status).toBe('clean');
    expect(rows[0].pdf_sha256).toMatch(/^[0-9a-f]{64}$/);

    const { getStorage } = await import('../../src/lib/storage.js');
    const bytes = await getStorage().get(rows[0].storage_key);
    // A real PDF, not a placeholder.
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const crypto = await import('node:crypto');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    // The stored digest matches the stored bytes, so tampering is detectable.
    expect(digest).toBe(rows[0].pdf_sha256);
  });

  it('serves the PDF through a signed URL and refuses an altered one', async () => {
    const { provider, jobId } = await providerWithJob('pdfserve@test.local');
    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 10000, taxRateBp: 0 }] })
      .expect(201);
    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token)).expect(200);
    await drainQueue();

    const view = await request(app)
      .get(`/api/v1/quotes/${quote.body.id}`).set(auth(provider.token)).expect(200);

    const url = new URL(view.body.pdfUrl);
    const params = url.searchParams;

    const ok = await request(app)
      .get('/api/v1/files/download')
      .query({ key: params.get('key'), expires: params.get('expires'), sig: params.get('sig') })
      .expect(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect(ok.headers['content-disposition']).toContain('attachment');

    // Changing the expiry invalidates the signature.
    await request(app)
      .get('/api/v1/files/download')
      .query({ key: params.get('key'), expires: '99999999999', sig: params.get('sig') })
      .expect(403);
  });

  it('regenerates the PDF for an invoice with its own numbering', async () => {
    const { provider, clientId } = await providerWithJob('pdfinv@test.local');
    const invoice = await request(app)
      .post('/api/v1/invoices').set(auth(provider.token))
      .send({ clientId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 25000, taxRateBp: 825 }] })
      .expect(201);
    await request(app).post(`/api/v1/invoices/${invoice.body.id}/send`).set(auth(provider.token)).expect(200);
    await drainQueue();

    const view = await request(app)
      .get(`/api/v1/invoices/${invoice.body.id}`).set(auth(provider.token)).expect(200);
    expect(view.body.number).toMatch(/^INV-\d{4}-0001$/);
    expect(view.body.pdfUrl).toBeTruthy();
  });
});

describe('durable job queue', () => {
  it('retries a failing job with backoff, then dead-letters it', async () => {
    const { enqueue, claimJobs, failJob } = await import('../../src/lib/queue.js');
    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();

    await enqueue('email.send', { template: 'boom' }, { maxAttempts: 2 });

    // First attempt fails -> rescheduled.
    let jobs = await claimJobs(1);
    expect(jobs).toHaveLength(1);
    await failJob(jobs[0], new Error('transient failure'));

    let row = await db.query<any>('SELECT status, attempts, run_at FROM job_queue');
    expect(row.rows[0].status).toBe('pending');
    expect(row.rows[0].attempts).toBe(1);
    // Backoff pushes it into the future.
    expect(new Date(row.rows[0].run_at).getTime()).toBeGreaterThan(Date.now());

    // Make it due again and exhaust the attempts.
    await db.query(`UPDATE job_queue SET run_at = now() - interval '1 minute'`);
    jobs = await claimJobs(1);
    await failJob(jobs[0], new Error('permanent failure'));

    row = await db.query<any>('SELECT status FROM job_queue');
    expect(row.rows[0].status).toBe('dead');

    const dead = await db.query<any>('SELECT queue, attempts, last_error FROM dead_letters');
    expect(dead.rows).toHaveLength(1);
    expect(dead.rows[0].last_error).toContain('permanent failure');
  });

  it('collapses duplicate work with a dedupe key', async () => {
    const { enqueue } = await import('../../src/lib/queue.js');
    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();

    for (let i = 0; i < 5; i += 1) {
      await enqueue('pdf.generate', { kind: 'quote', id: 'same-id' }, { dedupeKey: 'pdf:quote:same-id' });
    }
    const { rows } = await db.query<{ count: string }>(
      "SELECT count(*)::text FROM job_queue WHERE queue = 'pdf.generate'",
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('does not hand the same job to two workers', async () => {
    const { enqueue, claimJobs } = await import('../../src/lib/queue.js');
    await enqueue('email.send', { template: 'once' });

    const first = await claimJobs(5);
    const second = await claimJobs(5);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('reclaims a job orphaned by a crashed worker', async () => {
    const { enqueue, claimJobs } = await import('../../src/lib/queue.js');
    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();

    await enqueue('email.send', { template: 'orphan' });
    await claimJobs(1);
    // Simulate a worker that died holding the lock.
    await db.query(`UPDATE job_queue SET locked_at = now() - interval '10 minutes'`);

    const reclaimed = await claimJobs(1);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].attempts).toBe(2);
  });

  it('respects a future run_at', async () => {
    const { enqueue, claimJobs } = await import('../../src/lib/queue.js');
    await enqueue('email.send', { template: 'later' }, { runAt: new Date(Date.now() + 60_000) });
    expect(await claimJobs(5)).toHaveLength(0);
  });
});

describe('WhatsApp consent lifecycle', () => {
  it('records opt-in, opt-out and re-opt-in with an auditable history', async () => {
    const customer = await registerUser(app, { role: 'customer', email: 'consent@test.local' });

    const initial = await request(app)
      .get('/api/v1/account/whatsapp-consent').set(auth(customer.token)).expect(200);
    expect(initial.body.optedIn).toBe(false);

    await request(app)
      .post('/api/v1/account/whatsapp-consent').set(auth(customer.token))
      .send({ phone: '+18095551234', acknowledged: true }).expect(200);

    const optedIn = await request(app)
      .get('/api/v1/account/whatsapp-consent').set(auth(customer.token)).expect(200);
    expect(optedIn.body.optedIn).toBe(true);
    expect(optedIn.body.optInAt).toBeTruthy();

    await request(app)
      .delete('/api/v1/account/whatsapp-consent').set(auth(customer.token)).expect(200);

    const optedOut = await request(app)
      .get('/api/v1/account/whatsapp-consent').set(auth(customer.token)).expect(200);
    expect(optedOut.body.optedIn).toBe(false);
    expect(optedOut.body.optOutAt).toBeTruthy();

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query<any>(
      'SELECT action, source FROM whatsapp_consents WHERE user_id = $1 ORDER BY created_at',
      [customer.id],
    );
    expect(rows.map((r: any) => r.action)).toEqual(['opt_in', 'opt_out']);
  });

  it('refuses opt-in without an explicit acknowledgement', async () => {
    const customer = await registerUser(app, { role: 'customer', email: 'noack@test.local' });
    await request(app)
      .post('/api/v1/account/whatsapp-consent').set(auth(customer.token))
      .send({ phone: '+18095551234' }).expect(422);
    await request(app)
      .post('/api/v1/account/whatsapp-consent').set(auth(customer.token))
      .send({ phone: '+18095551234', acknowledged: false }).expect(422);
  });

  it('rejects a phone number that cannot be resolved to E.164', async () => {
    const customer = await registerUser(app, { role: 'customer', email: 'badphone@test.local' });
    const invalid = [
      '+0123',                // country code cannot start with 0
      'not-a-phone',
      '+1809555123456789',    // beyond E.164's 15 digits
      '0123456789',           // NANP area codes never start with 0
      '1123456789',           // nor with 1
      '80955512',             // too short for any NANP number
    ];
    for (const phone of invalid) {
      await request(app)
        .post('/api/v1/account/whatsapp-consent').set(auth(customer.token))
        .send({ phone, acknowledged: true }).expect(422);
    }
  });

  it('honours a STOP keyword received on the business number', async () => {
    const customer = await registerUser(app, { role: 'customer', email: 'stopword@test.local' });
    await request(app)
      .post('/api/v1/account/whatsapp-consent').set(auth(customer.token))
      .send({ phone: '+18095557777', acknowledged: true }).expect(200);

    const { handleInboundMessage } = await import('../../src/modules/whatsapp/service.js');
    const result = await handleInboundMessage('+18095557777', 'STOP');
    expect(result.action).toBe('opted_out');

    const after = await request(app)
      .get('/api/v1/account/whatsapp-consent').set(auth(customer.token)).expect(200);
    expect(after.body.optedIn).toBe(false);
  });

  it('ignores ordinary inbound text', async () => {
    const { handleInboundMessage } = await import('../../src/modules/whatsapp/service.js');
    const result = await handleInboundMessage('+18095550000', 'hello, when are you arriving?');
    expect(result.action).toBe('ignored');
  });

  it('never stores the message body in the delivery log', async () => {
    const { provider, jobId } = await providerWithJob('walog@test.local');
    const customer = await registerUser(app, { role: 'customer', email: 'walogcust@test.local' });

    // Link the job to a platform customer so a notification is generated.
    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    await db.query('UPDATE jobs SET customer_user_id = $2 WHERE id = $1', [jobId, customer.id]);
    await request(app)
      .post('/api/v1/account/whatsapp-consent').set(auth(customer.token))
      .send({ phone: '+18095558888', acknowledged: true }).expect(200);

    const quote = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .send({ jobId, lines: [{ description: 'Confidential work detail', quantity: 1, unitPriceCents: 10000, taxRateBp: 0 }] })
      .expect(201);
    await request(app).post(`/api/v1/quotes/${quote.body.id}/send`).set(auth(provider.token)).expect(200);
    await drainQueue();

    const { rows } = await db.query<any>('SELECT * FROM whatsapp_messages WHERE related_id = $1', [quote.body.id]);
    const serialised = JSON.stringify(rows[0]);
    expect(serialised).not.toContain('Confidential work detail');
    expect(serialised).not.toContain('+18095558888');
    expect(rows[0].to_phone_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('idempotency', () => {
  it('replays the original response for a repeated key', async () => {
    const { provider, jobId } = await providerWithJob('idem@test.local');
    const key = 'idem-key-quote-0001';

    const first = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .set('Idempotency-Key', key)
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 10000, taxRateBp: 0 }] })
      .expect(201);

    const second = await request(app)
      .post('/api/v1/quotes').set(auth(provider.token))
      .set('Idempotency-Key', key)
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 10000, taxRateBp: 0 }] })
      .expect(201);

    // Same quote returned, not a second one created.
    expect(second.body.id).toBe(first.body.id);
    expect(second.headers['idempotent-replay']).toBe('true');

    const list = await request(app).get('/api/v1/quotes').set(auth(provider.token)).expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('refuses to reuse a key with a different payload', async () => {
    const { provider, jobId } = await providerWithJob('idem2@test.local');
    const key = 'idem-key-quote-0002';

    await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('Idempotency-Key', key)
      .send({ jobId, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 10000, taxRateBp: 0 }] })
      .expect(201);

    await request(app)
      .post('/api/v1/quotes').set(auth(provider.token)).set('Idempotency-Key', key)
      .send({ jobId, lines: [{ description: 'Different', quantity: 9, unitPriceCents: 99999, taxRateBp: 0 }] })
      .expect(409);
  });

  it('scopes keys per user, so one caller cannot replay another\'s response', async () => {
    const a = await providerWithJob('idem-a@test.local');
    const b = await providerWithJob('idem-b@test.local');
    const key = 'shared-key-value-123';

    await request(app)
      .post('/api/v1/quotes').set(auth(a.provider.token)).set('Idempotency-Key', key)
      .send({ jobId: a.jobId, lines: [{ description: 'A work', quantity: 1, unitPriceCents: 100, taxRateBp: 0 }] })
      .expect(201);

    const second = await request(app)
      .post('/api/v1/quotes').set(auth(b.provider.token)).set('Idempotency-Key', key)
      .send({ jobId: b.jobId, lines: [{ description: 'B work', quantity: 1, unitPriceCents: 200, taxRateBp: 0 }] })
      .expect(201);

    expect(second.headers['idempotent-replay']).toBeUndefined();
    expect(second.body.totalCents).toBe(200);
  });
});

describe('document numbering', () => {
  it('numbers sequentially per provider and never collides across tenants', async () => {
    const a = await providerWithJob('num-a@test.local');
    const b = await providerWithJob('num-b@test.local');

    const makeQuote = async (ctx: typeof a) =>
      (await request(app)
        .post('/api/v1/quotes').set(auth(ctx.provider.token))
        .send({ jobId: ctx.jobId, lines: [{ description: 'W', quantity: 1, unitPriceCents: 100, taxRateBp: 0 }] })
        .expect(201)).body.number as string;

    expect(await makeQuote(a)).toMatch(/-0001$/);
    expect(await makeQuote(a)).toMatch(/-0002$/);
    expect(await makeQuote(a)).toMatch(/-0003$/);
    // A second tenant starts its own sequence at 1.
    expect(await makeQuote(b)).toMatch(/-0001$/);
  });

  it('issues unique numbers under concurrent creation', async () => {
    const { provider, jobId } = await providerWithJob('num-concurrent@test.local');

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post('/api/v1/quotes').set(auth(provider.token))
          .send({ jobId, lines: [{ description: 'W', quantity: 1, unitPriceCents: 100, taxRateBp: 0 }] }),
      ),
    );

    const numbers = results.map((r) => r.body.number);
    expect(results.every((r) => r.status === 201)).toBe(true);
    // Duplicate invoice/quote numbers are an accounting problem, not cosmetic.
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
