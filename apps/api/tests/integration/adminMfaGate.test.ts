import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, createAdmin, elevateToMfa, auth,
} from '../helpers/setup.js';

let app: Express;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => { await resetDatabase(); await seedCatalogue(); });

const envModule = async () => (await import('../../src/config/env.js')).env;

/**
 * The switch is read at call time, so a test can flip it without reloading the
 * whole config. Restored after every case so one test cannot leak the bypass
 * into another.
 */
let original: boolean;
beforeEach(async () => { original = (await envModule()).ADMIN_MFA_REQUIRED; });
afterEach(async () => {
  const env = await envModule() as { ADMIN_MFA_REQUIRED: boolean };
  env.ADMIN_MFA_REQUIRED = original;
});

const setGate = async (value: boolean) => {
  const env = await envModule() as { ADMIN_MFA_REQUIRED: boolean };
  env.ADMIN_MFA_REQUIRED = value;
};

async function setup() {
  const admin = await createAdmin(app);
  const provider = await registerUser(app, {
    role: 'provider', email: 'gated@test.local', businessName: 'Gated Co',
  });
  return { admin, provider };
}

describe('the two-factor gate on admin writes', () => {
  it('refuses a plain session while the gate is on', async () => {
    await setGate(true);
    const { admin, provider } = await setup();

    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
      .set(auth(admin.token))
      .send({ action: 'approve' })
      .expect(403);
  });

  it('still lets a two-factor session through while the gate is on', async () => {
    await setGate(true);
    const { admin, provider } = await setup();
    const mfa = await elevateToMfa(admin);

    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
      .set(auth(mfa))
      .send({ action: 'approve' })
      .expect(200);
  });

  it('lets a plain session through once the gate is off', async () => {
    await setGate(false);
    const { admin, provider } = await setup();

    // What the switch exists for: a local or demo deployment can use the panel
    // without enrolling a second factor.
    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
      .set(auth(admin.token))
      .send({ action: 'approve' })
      .expect(200);
  });

  it('opens nothing else: the gate is not authentication', async () => {
    await setGate(false);
    const { provider } = await setup();

    // A provider is still not an admin, and an anonymous caller is still
    // nobody. Turning the gate off must not turn the door off.
    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
      .set(auth(provider.token))
      .send({ action: 'approve' })
      .expect(403);

    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
      .send({ action: 'approve' })
      .expect(401);
  });

  it('does not relax the rest of the rules', async () => {
    await setGate(false);
    const { admin, provider } = await setup();

    // Reasons, transitions and the self-lockout guard are business rules, not
    // authentication, and the switch must leave every one of them standing.
    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
      .set(auth(admin.token)).send({ action: 'reject' })
      .expect(400);

    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
      .set(auth(admin.token)).send({ action: 'reinstate', reason: 'Not suspended at all.' })
      .expect(409);

    await request(app)
      .post(`/api/v1/admin/users/${admin.id}/status`)
      .set(auth(admin.token)).send({ status: 'suspended', reason: 'Testing the self guard.' })
      .expect(400);
  });

  it('tells the client whether the gate is on, so the panel can say so', async () => {
    const { admin } = await setup();

    await setGate(true);
    const gated = await request(app)
      .get('/api/v1/auth/me').set(auth(admin.token)).expect(200);
    expect(gated.body.adminMfaRequired).toBe(true);
    expect(gated.body.sessionAal).toBe('aal1');

    await setGate(false);
    const open = await request(app)
      .get('/api/v1/auth/me').set(auth(admin.token)).expect(200);
    // Without this the panel would stay disabled against a server that would
    // have accepted the write — lying in the other direction.
    expect(open.body.adminMfaRequired).toBe(false);
  });
});
