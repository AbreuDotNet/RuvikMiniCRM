import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, createAdmin, elevateToMfa,
  subscribeProvider, auth, STRONG_PASSWORD, type TestUser,
} from '../helpers/setup.js';

let app: Express;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => { await resetDatabase(); await seedCatalogue(); });

/**
 * Creates a master, optionally with a provider profile.
 *
 * Written straight to the table because that is the only way a master is ever
 * made: no endpoint grants the role, by design.
 */
async function createMaster(
  opts: { withProvider?: boolean; email?: string } = {},
): Promise<TestUser> {
  const { getDb } = await import('../../src/db/index.js');
  const { hashPassword } = await import('../../src/lib/crypto.js');
  const db = await getDb();
  const email = opts.email ?? 'master@test.local';

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, full_name, status, email_verified_at)
     VALUES ($1,$2,'master','Test Master','active', now()) RETURNING id`,
    [email, await hashPassword(STRONG_PASSWORD)],
  );

  let providerId: string | undefined;
  if (opts.withProvider) {
    const { rows: prov } = await db.query<{ id: string }>(
      `INSERT INTO providers (user_id, business_name, slug, city, region, country,
                              verification_status, is_published)
       VALUES ($1,'Master Co',$2,'Austin','TX','US','verified', false) RETURNING id`,
      [rows[0].id, `master-co-${Date.now()}`],
    );
    providerId = prov[0].id;
  }

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: STRONG_PASSWORD })
    .expect(200);

  return {
    id: rows[0].id, email, providerId,
    token: login.body.accessToken, refreshToken: login.body.refreshToken,
  };
}

/** Tightens a plan so a limit is easy to cross. */
async function capStarterAt(maxClients: number): Promise<void> {
  const { getDb } = await import('../../src/db/index.js');
  const db = await getDb();
  await db.query(
    `UPDATE subscription_plans SET max_clients = $1, max_services = 1 WHERE code = 'starter'`,
    [maxClients],
  );
}

describe('master acts as every role', () => {
  it('reaches the admin surface', async () => {
    const master = await createMaster();

    await request(app)
      .get('/api/v1/admin/metrics')
      .set(auth(master.token))
      .expect(200);

    await request(app)
      .get('/api/v1/admin/plans')
      .set(auth(master.token))
      .expect(200);
  });

  it('reaches the provider surface when it has a profile', async () => {
    const master = await createMaster({ withProvider: true });

    await request(app)
      .get('/api/v1/provider/dashboard')
      .set(auth(master.token))
      .expect(200);
  });

  it('is told what is missing, not refused, when it has no provider profile', async () => {
    // A missing prerequisite, not a limit: there is no provider to act on.
    const master = await createMaster();

    const res = await request(app)
      .get('/api/v1/provider/dashboard')
      .set(auth(master.token))
      .expect(403);

    expect(res.body.error.message).toMatch(/business profile/i);
  });

  it('reaches the customer surface', async () => {
    const master = await createMaster();

    await request(app)
      .get('/api/v1/customer/home')
      .set(auth(master.token))
      .expect(200);
  });
});

describe('master has no plan limits', () => {
  it('keeps adding clients past the plan ceiling', async () => {
    await capStarterAt(2);
    const master = await createMaster({ withProvider: true });

    // Deliberately on the tightest plan there is: the exemption must come from
    // the role, not from an absent subscription.
    await subscribeProvider(master.providerId!, 'active', 'starter');

    for (let i = 0; i < 6; i += 1) {
      await request(app)
        .post('/api/v1/provider/clients')
        .set(auth(master.token))
        .send({ fullName: `Client ${i}` })
        .expect(201);
    }
  });

  it('reports unlimited everything, with every capability', async () => {
    await capStarterAt(2);
    const master = await createMaster({ withProvider: true });
    await subscribeProvider(master.providerId!, 'active', 'starter');

    const res = await request(app)
      .get('/api/v1/provider/entitlements')
      .set(auth(master.token))
      .expect(200);

    expect(res.body.plan.code).toBe('master');
    expect(res.body.limits).toMatchObject({
      maxClients: null,
      maxReceiptsPerMonth: null,
      maxServices: null,
      maxQuotesPerMonth: null,
    });
    expect(res.body.capabilities).toEqual(
      expect.arrayContaining(['fiscal_reports', 'tax_estimates', 'team_members']),
    );
    expect(res.body.usage.clients.exhausted).toBe(false);
  });

  it('still caps an ordinary provider on the same plan', async () => {
    // The control. Without it, a passing exemption test could just mean the
    // limit stopped working for everybody.
    await capStarterAt(2);
    const provider = await registerUser(app, {
      role: 'provider', email: 'ordinary@test.local', businessName: 'Ordinary Co',
    });
    await subscribeProvider(provider.providerId!, 'active', 'starter');

    await request(app).post('/api/v1/provider/clients')
      .set(auth(provider.token)).send({ fullName: 'One' }).expect(201);
    await request(app).post('/api/v1/provider/clients')
      .set(auth(provider.token)).send({ fullName: 'Two' }).expect(201);
    await request(app).post('/api/v1/provider/clients')
      .set(auth(provider.token)).send({ fullName: 'Three' }).expect(409);
  });
});

describe('what master does not bypass', () => {
  it('still needs two-factor for an administrative change', async () => {
    /*
     * The deliberate limit. A role with no limits that also skipped the second
     * factor would be the single most valuable account to steal, and the
     * easiest to abuse once stolen. No product limit is worth that.
     */
    const { env } = await import('../../src/config/env.js');
    const original = env.ADMIN_MFA_REQUIRED;
    (env as { ADMIN_MFA_REQUIRED: boolean }).ADMIN_MFA_REQUIRED = true;

    try {
      const master = await createMaster();
      const provider = await registerUser(app, {
        role: 'provider', email: 'gated@test.local', businessName: 'Gated Co',
      });

      await request(app)
        .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
        .set(auth(master.token))
        .send({ action: 'approve' })
        .expect(403);

      // And passes once the factor is satisfied, like anybody else.
      const elevated = await elevateToMfa({ ...master, id: master.id });
      await request(app)
        .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
        .set(auth(elevated))
        .send({ action: 'approve' })
        .expect(200);
    } finally {
      (env as { ADMIN_MFA_REQUIRED: boolean }).ADMIN_MFA_REQUIRED = original;
    }
  });

  it('still needs to sign in', async () => {
    await createMaster();
    await request(app).get('/api/v1/admin/metrics').expect(401);
  });

  it('still reads only its own provider data', async () => {
    // Tenant isolation holds. Reading someone else's books is impersonation,
    // which needs consent, a time limit and an audit entry per read — not a
    // role flag.
    const master = await createMaster({ withProvider: true });
    const other = await registerUser(app, {
      role: 'provider', email: 'other@test.local', businessName: 'Other Co',
    });

    const theirClient = await request(app)
      .post('/api/v1/provider/clients')
      .set(auth(other.token))
      .send({ fullName: 'Their Client' })
      .expect(201);

    await request(app)
      .get(`/api/v1/provider/clients/${theirClient.body.id}`)
      .set(auth(master.token))
      .expect(404);
  });
});

describe('the hierarchy is not decorative', () => {
  it('an admin cannot suspend a master', async () => {
    const admin = await createAdmin(app);
    const mfa = await elevateToMfa(admin);
    const master = await createMaster();

    const res = await request(app)
      .post(`/api/v1/admin/users/${master.id}/status`)
      .set(auth(mfa))
      .send({ status: 'suspended', reason: 'Trying to remove the owner.' })
      .expect(403);

    expect(res.body.error.message).toMatch(/above your level/i);
  });

  it('a master can suspend an admin', async () => {
    const admin = await createAdmin(app, 'victim@test.local');
    const master = await createMaster();
    const mfa = await elevateToMfa({ ...master, id: master.id });

    await request(app)
      .post(`/api/v1/admin/users/${admin.id}/status`)
      .set(auth(mfa))
      .send({ status: 'suspended', reason: 'Offboarding this administrator.' })
      .expect(200);
  });

  it('no endpoint hands out the role', async () => {
    // Signing up as a master must be impossible: the schema only accepts
    // customer and provider, and nothing else writes the column.
    await request(app)
      .post('/api/v1/auth/signup')
      .send({
        email: 'wannabe@test.local',
        password: STRONG_PASSWORD,
        fullName: 'Wannabe Master',
        role: 'master',
      })
      .expect(422);
  });
});
