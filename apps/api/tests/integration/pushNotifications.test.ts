import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, publishProvider,
  drainQueue, auth, type TestUser,
} from '../helpers/setup.js';

let app: Express;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => { await resetDatabase(); await seedCatalogue(); });

const db = async () => (await import('../../src/db/index.js')).getDb();
const envModule = async () => (await import('../../src/config/env.js')).env;

let originalPush: boolean;
beforeEach(async () => { originalPush = (await envModule()).PUSH_ENABLED; });
afterEach(async () => {
  const env = (await envModule()) as { PUSH_ENABLED: boolean };
  env.PUSH_ENABLED = originalPush;
  vi.unstubAllGlobals();
});

const TOKEN_A = 'ExponentPushToken[handset-a]';
const TOKEN_B = 'ExponentPushToken[handset-b]';

async function tokensFor(userId: string): Promise<string[]> {
  const conn = await db();
  const { rows } = await conn.query<{ token: string }>(
    'SELECT token FROM device_tokens WHERE user_id = $1 ORDER BY token',
    [userId],
  );
  return rows.map((r) => r.token);
}

async function allTokenRows(): Promise<Array<{ token: string; user_id: string; failure_count: number }>> {
  const conn = await db();
  const { rows } = await conn.query<{ token: string; user_id: string; failure_count: number }>(
    'SELECT token, user_id, failure_count FROM device_tokens ORDER BY token',
  );
  return rows;
}

const registerDevice = (user: TestUser, token: string, platform = 'ios') =>
  request(app)
    .put('/api/v1/account/devices')
    .set(auth(user.token))
    .send({ token, platform })
    .expect(200);

/** A customer request, which is what raises `lead.new` on the provider. */
async function raiseLead(customer: TestUser, providerId: string) {
  await request(app)
    .post('/api/v1/customer/requests')
    .set(auth(customer.token))
    .send({
      providerId,
      title: 'Leaking water heater',
      description: 'Water pooling under the tank since this morning, please help.',
      city: 'Austin',
      region: 'TX',
    })
    .expect(201);
}

async function setup() {
  const provider = await registerUser(app, {
    role: 'provider', email: 'push-pro@test.local', businessName: 'Push Plumbing', city: 'Austin',
  });
  await publishProvider(provider.providerId!);
  const customer = await registerUser(app, { role: 'customer', email: 'push-cust@test.local' });
  return { provider, customer };
}

/* ========================================================================== */
/* Registration                                                               */
/* ========================================================================== */

describe('registering a device', () => {
  it('stores the token against the signed-in user', async () => {
    const { provider } = await setup();
    await registerDevice(provider, TOKEN_A);
    expect(await tokensFor(provider.id)).toEqual([TOKEN_A]);
  });

  it('is idempotent, because it runs on every cold start', async () => {
    const { provider } = await setup();
    await registerDevice(provider, TOKEN_A);
    await registerDevice(provider, TOKEN_A);
    await registerDevice(provider, TOKEN_A);
    expect(await tokensFor(provider.id)).toEqual([TOKEN_A]);
  });

  it('keeps a second handset alongside the first', async () => {
    const { provider } = await setup();
    await registerDevice(provider, TOKEN_A);
    await registerDevice(provider, TOKEN_B, 'android');
    expect(await tokensFor(provider.id)).toEqual([TOKEN_A, TOKEN_B]);
  });

  /**
   * The case this table's unique index exists for: one handset, two accounts.
   * Without the reassignment the first user's leads keep ringing on a phone
   * that is now signed in as somebody else.
   */
  it('moves a handset to whoever signed in last', async () => {
    const { provider, customer } = await setup();
    await registerDevice(provider, TOKEN_A);
    await registerDevice(customer, TOKEN_A);

    expect(await tokensFor(provider.id)).toEqual([]);
    expect(await tokensFor(customer.id)).toEqual([TOKEN_A]);
  });

  it('refuses a platform it cannot deliver to', async () => {
    const { provider } = await setup();
    await request(app)
      .put('/api/v1/account/devices')
      .set(auth(provider.token))
      .send({ token: TOKEN_A, platform: 'blackberry' })
      .expect(422);
  });

  it('needs a session', async () => {
    await request(app)
      .put('/api/v1/account/devices')
      .send({ token: TOKEN_A, platform: 'ios' })
      .expect(401);
  });
});

/* ========================================================================== */
/* Unregistration                                                             */
/* ========================================================================== */

describe('unregistering a device', () => {
  it('releases the handset on sign-out', async () => {
    const { provider } = await setup();
    await registerDevice(provider, TOKEN_A);

    await request(app)
      .delete('/api/v1/account/devices')
      .set(auth(provider.token))
      .send({ token: TOKEN_A })
      .expect(200);

    expect(await tokensFor(provider.id)).toEqual([]);
  });

  /** Presenting somebody else's token must not unregister their phone. */
  it('cannot release a handset belonging to another account', async () => {
    const { provider, customer } = await setup();
    await registerDevice(provider, TOKEN_A);

    await request(app)
      .delete('/api/v1/account/devices')
      .set(auth(customer.token))
      .send({ token: TOKEN_A })
      .expect(200);

    expect(await tokensFor(provider.id)).toEqual([TOKEN_A]);
  });
});

/* ========================================================================== */
/* Delivery                                                                   */
/* ========================================================================== */

describe('delivering a notification', () => {
  it('queues a push alongside the in-app notification', async () => {
    const { provider, customer } = await setup();
    await registerDevice(provider, TOKEN_A);

    await raiseLead(customer, provider.providerId!);

    const conn = await db();
    const { rows } = await conn.query<{ count: string }>(
      `SELECT count(*)::text FROM job_queue WHERE queue = 'notification.push'`,
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('rings every handset the provider has registered', async () => {
    const { provider, customer } = await setup();
    await registerDevice(provider, TOKEN_A);
    await registerDevice(provider, TOKEN_B, 'android');

    await import('../../src/lib/push.js');
    const env = (await envModule()) as { PUSH_ENABLED: boolean };
    env.PUSH_ENABLED = true;
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ status: 'ok', id: 't1' }, { status: 'ok', id: 't2' }] }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await raiseLead(customer, provider.providerId!);
    await drainQueue();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body);
    expect(sent.map((m: { to: string }) => m.to).sort()).toEqual([TOKEN_A, TOKEN_B]);
    // The badge is the recipient's real unread count, read at send time.
    expect(sent[0].badge).toBe(1);
  });

  it('is a no-op for a user with no devices, not a failure', async () => {
    const { provider, customer } = await setup();

    await raiseLead(customer, provider.providerId!);
    await drainQueue();

    const conn = await db();
    const { rows } = await conn.query<{ status: string }>(
      `SELECT status FROM job_queue WHERE queue = 'notification.push'`,
    );
    expect(rows.every((r) => r.status === 'done')).toBe(true);
  });

  /**
   * A token outlives a suspension. `authenticate` stops a suspended account
   * *using* the app; only this handler can stop one being notified by it.
   */
  it('does not notify a suspended account', async () => {
    const { provider, customer } = await setup();
    await registerDevice(provider, TOKEN_A);
    await raiseLead(customer, provider.providerId!);

    const conn = await db();
    await conn.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [provider.id]);

    const env = (await envModule()) as { PUSH_ENABLED: boolean };
    env.PUSH_ENABLED = true;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await drainQueue();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* Pruning                                                                    */
/* ========================================================================== */

describe('pruning dead handsets', () => {
  it('drops a token whose app was uninstalled', async () => {
    const { provider, customer } = await setup();
    await registerDevice(provider, TOKEN_A);

    const env = (await envModule()) as { PUSH_ENABLED: boolean };
    env.PUSH_ENABLED = true;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }],
      }),
      text: async () => '',
    })));

    await raiseLead(customer, provider.providerId!);
    await drainQueue();

    expect(await tokensFor(provider.id)).toEqual([]);
  });

  /**
   * A soft error is not a dead handset: a rate limit or a transient Expo fault
   * must cost the token a strike, not its registration.
   */
  it('counts a soft failure instead of dropping the token', async () => {
    const { provider, customer } = await setup();
    await registerDevice(provider, TOKEN_A);

    const env = (await envModule()) as { PUSH_ENABLED: boolean };
    env.PUSH_ENABLED = true;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } }],
      }),
      text: async () => '',
    })));

    await raiseLead(customer, provider.providerId!);
    await drainQueue();

    const rows = await allTokenRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].failure_count).toBe(1);
  });

  it('clears the strikes when the handset registers again', async () => {
    const { provider } = await setup();
    await registerDevice(provider, TOKEN_A);

    const conn = await db();
    await conn.query('UPDATE device_tokens SET failure_count = 7 WHERE token = $1', [TOKEN_A]);

    await registerDevice(provider, TOKEN_A);

    const rows = await allTokenRows();
    expect(rows[0].failure_count).toBe(0);
  });

  it('takes the tokens with the account when it is deleted', async () => {
    const { provider } = await setup();
    await registerDevice(provider, TOKEN_A);

    const conn = await db();
    await conn.query('DELETE FROM users WHERE id = $1', [provider.id]);

    expect(await allTokenRows()).toEqual([]);
  });
});
