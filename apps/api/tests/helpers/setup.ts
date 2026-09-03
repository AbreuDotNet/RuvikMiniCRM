import type { Express } from 'express';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED ?? 'false';
process.env.JWT_ACCESS_SECRET = 'test-jwt-secret-value-at-least-32-chars-long';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long';
process.env.HASH_PEPPER = 'test-hash-pepper-16-chars';
process.env.BILLING_WEBHOOK_SECRET = 'test-billing-webhook-secret-value';
process.env.WHATSAPP_APP_SECRET = 'test-whatsapp-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.STORAGE_DIR = '.data/test-storage';

let app: Express | null = null;

/** Boots an app against a fresh in-memory Postgres with the schema applied. */
export async function getTestApp(): Promise<Express> {
  if (app) return app;
  const { runMigrations } = await import('../../src/db/migrate.js');
  const { createApp } = await import('../../src/app.js');
  await runMigrations();
  app = createApp();
  return app;
}

export async function resetDatabase(): Promise<void> {
  const { getDb } = await import('../../src/db/index.js');
  const db = await getDb();
  await db.exec(`
    TRUNCATE TABLE
      audit_logs, job_queue, dead_letters, webhook_events, idempotency_keys,
      whatsapp_messages, whatsapp_consents, notifications, support_tickets,
      provider_status_events, reviews, payments, subscriptions, invoice_items, invoices,
      quote_items, quotes, job_notes, job_status_events, jobs, clients,
      provider_portfolio_images, services, files, providers, customer_profiles,
      password_resets, refresh_tokens, users, number_sequences
    RESTART IDENTITY CASCADE;
  `);
}

export async function seedCatalogue(): Promise<{ categoryId: string; planIds: Record<string, string> }> {
  const { getDb } = await import('../../src/db/index.js');
  const db = await getDb();

  const { rows: cat } = await db.query<{ id: string }>(
    `INSERT INTO categories (slug, name, icon, sort_order)
     VALUES ('plumbing','Plumbing','plumbing',10)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );

  const planIds: Record<string, string> = {};
  for (const [code, name, price, maxServices] of [
    ['starter', 'Starter', 0, 3],
    ['pro', 'Pro', 2900, 25],
  ] as const) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO subscription_plans (code, name, price_cents, interval, max_services)
       VALUES ($1,$2,$3,'month',$4)
       ON CONFLICT (code) DO UPDATE SET price_cents = EXCLUDED.price_cents
       RETURNING id`,
      [code, name, price, maxServices],
    );
    planIds[code] = rows[0].id;
  }
  return { categoryId: cat[0].id, planIds };
}

export const STRONG_PASSWORD = 'Correct-Horse-Battery-7';

export interface TestUser {
  id: string;
  email: string;
  token: string;
  refreshToken: string;
  providerId?: string;
}

/** Registers a user through the real signup endpoint and returns their tokens. */
export async function registerUser(
  app: Express,
  opts: { role: 'customer' | 'provider'; email: string; businessName?: string; city?: string },
): Promise<TestUser> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({
      email: opts.email,
      password: STRONG_PASSWORD,
      fullName: opts.role === 'provider' ? 'Test Provider' : 'Test Customer',
      role: opts.role,
      businessName: opts.businessName,
      city: opts.city ?? 'Santo Domingo',
    })
    .expect(201);

  return {
    id: res.body.user.id,
    email: opts.email,
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    providerId: res.body.user.providerId ?? undefined,
  };
}

export async function createAdmin(app: Express, email = 'admin@test.local'): Promise<TestUser> {
  const { getDb } = await import('../../src/db/index.js');
  const { hashPassword } = await import('../../src/lib/crypto.js');
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, full_name, status, email_verified_at)
     VALUES ($1,$2,'admin','Test Admin','active', now()) RETURNING id`,
    [email, await hashPassword(STRONG_PASSWORD)],
  );

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: STRONG_PASSWORD })
    .expect(200);

  return { id: rows[0].id, email, token: login.body.accessToken, refreshToken: login.body.refreshToken };
}

/**
 * Admin write routes require MFA (aal=mfa). Tests mint an elevated token
 * directly rather than driving a TOTP app.
 */
export async function elevateToMfa(user: TestUser): Promise<string> {
  const { signAccessToken } = await import('../../src/lib/tokens.js');
  return signAccessToken({ userId: user.id, role: 'admin', aal: 'mfa' });
}

/** Publishes a provider so it appears in public search. */
export async function publishProvider(providerId: string, verified = true): Promise<void> {
  const { getDb } = await import('../../src/db/index.js');
  const db = await getDb();
  await db.query(
    `UPDATE providers SET is_published = true,
            verification_status = $2,
            verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END
      WHERE id = $1`,
    [providerId, verified ? 'verified' : 'pending'],
  );
}

/** Runs the background queue until it drains, so async effects are assertable. */
export async function drainQueue(maxTicks = 40): Promise<void> {
  const { claimJobs, completeJob, failJob } = await import('../../src/lib/queue.js');
  const { HANDLERS } = await import('../../src/workers/handlers.js');

  for (let i = 0; i < maxTicks; i += 1) {
    const jobs = await claimJobs(10);
    if (!jobs.length) return;
    for (const job of jobs) {
      const handler = HANDLERS[job.queue];
      if (!handler) {
        await failJob(job, new Error('no handler'));
        continue;
      }
      try {
        await handler(job.payload);
        await completeJob(job.id);
      } catch (err) {
        await failJob(job, err);
      }
    }
  }
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
