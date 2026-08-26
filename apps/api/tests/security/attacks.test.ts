import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import crypto from 'node:crypto';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, publishProvider,
  auth, STRONG_PASSWORD, drainQueue,
} from '../helpers/setup.js';

let app: Express;
let categoryId: string;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => {
  await resetDatabase();
  ({ categoryId } = await seedCatalogue());
});

describe('SQL injection', () => {
  const PAYLOADS = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "1' UNION SELECT null, email, password_hash FROM users --",
    "admin'--",
    "') OR 1=1--",
  ];

  it('treats injection strings in search as literal text', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'sqli@test.local', businessName: 'SQLi Test Co',
    });
    await publishProvider(provider.providerId!);
    await request(app)
      .post('/api/v1/provider/services').set(auth(provider.token))
      .send({ categoryId, title: 'Normal service', pricingType: 'fixed', priceCents: 1000, status: 'active' })
      .expect(201);

    for (const payload of PAYLOADS) {
      const res = await request(app)
        .get('/api/v1/search/services').query({ q: payload }).expect(200);
      // No rows leak and nothing errors: the payload is just a search term.
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('password_hash');
      expect(JSON.stringify(res.body)).not.toContain('$argon2');
    }

    // The table is still there afterwards.
    await request(app).get('/api/v1/search/services').expect(200);
  });

  it('does not authenticate on an injected login', async () => {
    for (const payload of PAYLOADS) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: `${payload}@test.local`, password: payload });
      expect([401, 422]).toContain(res.status);
      expect(res.body.accessToken).toBeUndefined();
    }
  });

  it('rejects injected values in filters that reach the query builder', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'sqli2@test.local', businessName: 'SQLi Two Co',
    });
    // status is an enum: anything else is refused before touching SQL.
    await request(app)
      .get('/api/v1/provider/jobs').query({ status: "new_lead' OR '1'='1" })
      .set(auth(provider.token)).expect(422);
  });
});

describe('XSS and content injection', () => {
  it('stores script payloads as inert text and never reflects them as HTML', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'xss@test.local', businessName: 'XSS Test Co',
    });
    await publishProvider(provider.providerId!);

    const payload = '<script>alert(document.cookie)</script>';
    await request(app)
      .post('/api/v1/provider/services').set(auth(provider.token))
      .send({
        categoryId, title: `Cleaning ${payload}`, pricingType: 'fixed',
        priceCents: 1000, status: 'active',
      })
      .expect(201);

    const res = await request(app).get('/api/v1/search/services').expect(200);

    // The API never serves HTML, and nosniff stops a browser guessing
    // otherwise — so the payload cannot execute even though it round-trips.
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-type']).not.toContain('text/html');
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    // It is carried as a JSON string value, not as markup in the document.
    expect(res.body.data[0].title).toBe(`Cleaning ${payload}`);
    expect(res.text.startsWith('{')).toBe(true);
  });

  it('strips control characters that would corrupt PDFs and logs', async () => {
    const provider = await registerUser(app, {
      role: 'provider', email: 'ctrl@test.local', businessName: 'Control Co',
    });
    const client = await request(app)
      .post('/api/v1/provider/clients').set(auth(provider.token))
      .send({ fullName: 'Bad\u0000Name\u001FWithControls' }).expect(201);

    const view = await request(app)
      .get(`/api/v1/provider/clients/${client.body.id}`).set(auth(provider.token)).expect(200);
    expect(view.body.fullName).toBe('BadNameWithControls');
  });

  it('sets a restrictive CSP and denies framing', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('brute force and account lockout', () => {
  it('locks the account after repeated failures and keeps the message uniform', async () => {
    const email = 'lockme@test.local';
    await registerUser(app, { role: 'customer', email });

    const messages = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: `wrong-password-${i}` })
        .expect(401);
      messages.add(res.body.error.message);
    }
    // Every failure looks identical.
    expect(messages.size).toBe(1);

    // The correct password is now refused too: the account is locked.
    const locked = await request(app)
      .post('/api/v1/auth/login').send({ email, password: STRONG_PASSWORD }).expect(403);
    expect(locked.body.error.message).toContain('Too many failed attempts');
  });

  it('does not reveal whether an email is registered', async () => {
    await registerUser(app, { role: 'customer', email: 'known@test.local' });

    const known = await request(app)
      .post('/api/v1/auth/login').send({ email: 'known@test.local', password: 'wrong-password-here' }).expect(401);
    const unknown = await request(app)
      .post('/api/v1/auth/login').send({ email: 'unknown@test.local', password: 'wrong-password-here' }).expect(401);

    expect(known.body.error.message).toBe(unknown.body.error.message);
    expect(known.body.error.code).toBe(unknown.body.error.code);
  });

  it('returns the same response from password reset whether or not the account exists', async () => {
    await registerUser(app, { role: 'customer', email: 'resetknown@test.local' });

    const a = await request(app)
      .post('/api/v1/auth/password/forgot').send({ email: 'resetknown@test.local' }).expect(202);
    const b = await request(app)
      .post('/api/v1/auth/password/forgot').send({ email: 'nobody@test.local' }).expect(202);
    expect(a.body).toEqual(b.body);
  });

  it('rejects weak and common passwords at signup', async () => {
    for (const password of ['short', 'password123', 'aaaaaaaaaaaaaa']) {
      await request(app)
        .post('/api/v1/auth/signup')
        .send({ email: `weak-${password}@test.local`, password, fullName: 'Weak User', role: 'customer' })
        .expect(422);
    }
  });
});

describe('token handling', () => {
  it('revokes the whole family when a rotated refresh token is replayed', async () => {
    const user = await registerUser(app, { role: 'customer', email: 'rotate@test.local' });

    const first = await request(app)
      .post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(200);
    const rotated = first.body.refreshToken;

    // Replaying the original is treated as theft.
    await request(app)
      .post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);

    // ...and the legitimate successor is revoked too.
    await request(app)
      .post('/api/v1/auth/refresh').send({ refreshToken: rotated }).expect(401);
  });

  it('invalidates all sessions after a password change', async () => {
    const user = await registerUser(app, { role: 'customer', email: 'pwchange@test.local' });

    await request(app)
      .post('/api/v1/auth/password/change').set(auth(user.token))
      .send({ currentPassword: STRONG_PASSWORD, newPassword: 'Brand-New-Password-9' })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
  });

  it('rejects a token signed with the wrong key', async () => {
    const { SignJWT } = await import('jose');
    const forged = await new SignJWT({ role: 'admin', aal: 'mfa' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('00000000-0000-4000-8000-000000000000')
      .setIssuer('ruvik').setAudience('ruvik-api')
      .setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode('attacker-controlled-secret-value-32chars'));

    await request(app).get('/api/v1/admin/metrics').set(auth(forged)).expect(401);
  });

  it('rejects an expired token', async () => {
    const { SignJWT } = await import('jose');
    const expired = await new SignJWT({ role: 'customer', aal: 'aal1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('00000000-0000-4000-8000-000000000000')
      .setIssuer('ruvik').setAudience('ruvik-api')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));

    await request(app).get('/api/v1/account/profile').set(auth(expired)).expect(401);
  });

  it('logs out by revoking the presented refresh token', async () => {
    const user = await registerUser(app, { role: 'customer', email: 'logout@test.local' });
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: user.refreshToken }).expect(204);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
  });
});

describe('webhook spoofing', () => {
  it('rejects a billing webhook with no signature', async () => {
    await request(app)
      .post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', data: { reference: 'sub_x' } }))
      .expect(403);
  });

  it('rejects a forged signature', async () => {
    const body = JSON.stringify({ id: 'evt_2', type: 'payment.succeeded', data: { reference: 'sub_x' } });
    await request(app)
      .post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('X-Ruvik-Signature', `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`)
      .send(body)
      .expect(403);
  });

  it('rejects a replayed signature outside the timestamp window', async () => {
    const body = JSON.stringify({ id: 'evt_3', type: 'payment.succeeded', data: { reference: 'sub_x' } });
    const staleTs = Math.floor(Date.now() / 1000) - 3600;
    const v1 = crypto
      .createHmac('sha256', process.env.BILLING_WEBHOOK_SECRET!)
      .update(`${staleTs}.${body}`).digest('hex');

    await request(app)
      .post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('X-Ruvik-Signature', `t=${staleTs},v1=${v1}`)
      .send(body)
      .expect(403);
  });

  it('rejects a body that was modified after signing', async () => {
    const signed = JSON.stringify({ id: 'evt_4', type: 'payment.succeeded', data: { reference: 'sub_a', amountCents: 1 } });
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', process.env.BILLING_WEBHOOK_SECRET!)
      .update(`${t}.${signed}`).digest('hex');

    const tampered = JSON.stringify({ id: 'evt_4', type: 'payment.succeeded', data: { reference: 'sub_a', amountCents: 999999 } });
    await request(app)
      .post('/api/v1/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('X-Ruvik-Signature', `t=${t},v1=${v1}`)
      .send(tampered)
      .expect(403);
  });

  it('rejects an unsigned WhatsApp webhook and a bad verify token', async () => {
    await request(app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ entry: [] }))
      .expect(403);

    await request(app)
      .get('/api/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '123' })
      .expect(403);
  });

  it('completes the WhatsApp verification handshake with the right token', async () => {
    const res = await request(app)
      .get('/api/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': 'chal123' })
      .expect(200);
    expect(res.text).toBe('chal123');
  });
});

describe('file upload abuse', () => {
  async function providerToken() {
    const provider = await registerUser(app, {
      role: 'provider', email: `upload-${crypto.randomBytes(4).toString('hex')}@test.local`,
      businessName: 'Upload Test Co',
    });
    return provider.token;
  }

  it('rejects a file whose bytes do not match the declared type', async () => {
    const token = await providerToken();
    await request(app)
      .post('/api/v1/files/uploads').set(auth(token))
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<?php system($_GET["c"]); ?>'))
      .expect(415);
  });

  it('rejects an SVG, which can carry script', async () => {
    const token = await providerToken();
    await request(app)
      .post('/api/v1/files/uploads').set(auth(token))
      .set('Content-Type', 'image/svg+xml')
      .send(Buffer.from('<svg onload="alert(1)"></svg>'))
      // Not in the accepted media types, so the raw parser never populates a body.
      .expect(400);
  });

  it('quarantines an accepted upload until the scanner clears it', async () => {
    const token = await providerToken();
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(256, 7),
    ]);

    const res = await request(app)
      .post('/api/v1/files/uploads').set(auth(token))
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(201);
    expect(res.body.scanStatus).toBe('pending');

    await drainQueue();

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query('SELECT scan_status FROM files WHERE id = $1', [res.body.id]);
    expect(rows[0].scan_status).toBe('clean');
  });

  it('quarantines and deletes a polyglot that smuggles markup', async () => {
    const token = await providerToken();
    const polyglot = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('<script>alert(1)</script>'),
    ]);

    const res = await request(app)
      .post('/api/v1/files/uploads').set(auth(token))
      .set('Content-Type', 'image/png').send(polyglot).expect(201);

    await drainQueue();

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    const { rows } = await db.query('SELECT scan_status FROM files WHERE id = $1', [res.body.id]);
    expect(rows[0].scan_status).toBe('infected');
  });

  it('requires authentication to upload', async () => {
    await request(app)
      .post('/api/v1/files/uploads')
      .set('Content-Type', 'image/png')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      .expect(401);
  });
});

describe('signed download URLs', () => {
  it('refuses an unsigned or tampered download', async () => {
    await request(app)
      .get('/api/v1/files/download')
      .query({ key: 'quote_pdf/x/2026/08/abc.pdf', expires: '99999999999', sig: 'forged-signature' })
      .expect(403);
  });

  it('refuses a path traversal in the storage key', async () => {
    const { signStorageUrl } = await import('../../src/lib/storage.js');
    // Signing itself refuses to mint a URL for a traversal key.
    expect(() => signStorageUrl('../../etc/passwd')).toThrow();

    const res = await request(app)
      .get('/api/v1/files/download')
      .query({ key: '../../../etc/passwd', expires: '99999999999', sig: 'x'.repeat(20) });
    expect([403, 404, 422]).toContain(res.status);
  });

  it('refuses a signature that has expired', async () => {
    const { assertSafeKey } = await import('../../src/lib/storage.js');
    const key = 'quote_pdf/tenant/2026/08/file.pdf';
    assertSafeKey(key);
    const past = Math.floor(Date.now() / 1000) - 10;
    const sig = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY!)
      .update(`${key}:${past}`).digest('base64url');

    await request(app)
      .get('/api/v1/files/download').query({ key, expires: String(past), sig })
      .expect(403);
  });
});

describe('request limits and rate limiting', () => {
  it('rejects a body over the JSON size limit', async () => {
    const huge = { fullName: 'x'.repeat(400_000) };
    const res = await request(app).post('/api/v1/auth/signup').send(huge);
    expect([400, 413, 422]).toContain(res.status);
  });

  it('blocks a caller that exceeds its bucket', async () => {
    // Rate limiting is disabled across the suite, so this exercises the
    // middleware directly on a probe app.
    const { rateLimit } = await import('../../src/middleware/rateLimit.js');
    const { getCache } = await import('../../src/lib/cache.js');
    const { env } = await import('../../src/config/env.js');
    const { errorHandler } = await import('../../src/middleware/errorHandler.js');

    (env as { RATE_LIMIT_ENABLED: boolean }).RATE_LIMIT_ENABLED = true;

    const express = (await import('express')).default;
    const probe = express();
    probe.get(
      '/probe',
      rateLimit({ name: `probe-${crypto.randomBytes(4).toString('hex')}`, windowSeconds: 60, max: 3 }),
      (_req, res) => { res.json({ ok: true }); },
    );
    probe.use(errorHandler);

    await getCache();
    for (let i = 0; i < 3; i += 1) await request(probe).get('/probe').expect(200);

    const blocked = await request(probe).get('/probe').expect(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    expect(blocked.headers['retry-after']).toBeDefined();

    (env as { RATE_LIMIT_ENABLED: boolean }).RATE_LIMIT_ENABLED = false;
  });
});
