import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, resetDatabase, seedCatalogue, registerUser, createAdmin,
  elevateToMfa, auth, publishProvider,
} from '../helpers/setup.js';

let app: Express;

beforeAll(async () => { app = await getTestApp(); });
beforeEach(async () => { await resetDatabase(); await seedCatalogue(); });

const REASON = 'Licence number could not be matched against the state register.';

async function setup() {
  const admin = await createAdmin(app);
  const mfa = await elevateToMfa(admin);
  const provider = await registerUser(app, {
    role: 'provider', email: 'lifecycle@test.local', businessName: 'Lifecycle Co',
  });
  return { admin, mfa, provider };
}

const act = (mfa: string, providerId: string, action: string, reason?: string) =>
  request(app)
    .post(`/api/v1/admin/providers/${providerId}/actions`)
    .set(auth(mfa))
    .send({ action, ...(reason ? { reason } : {}) });

const detail = (token: string, providerId: string) =>
  request(app).get(`/api/v1/admin/providers/${providerId}`).set(auth(token));

/* ========================================================================== */

describe('provider lifecycle — state and available actions', () => {
  it('reports the merged state and only the actions legal from it', async () => {
    const { admin, provider } = await setup();

    const fresh = await detail(admin.token, provider.providerId!).expect(200);
    expect(fresh.body.state).toBe('unverified');
    const names = fresh.body.availableActions.map((a: any) => a.action);
    expect(names).toContain('approve');
    expect(names).toContain('reject');
    expect(names).not.toContain('reinstate');
    expect(names).not.toContain('unblock');
  });

  it('stops offering approval once the provider is verified', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);

    const after = await detail(admin.token, provider.providerId!).expect(200);
    expect(after.body.state).toBe('verified');
    const names = after.body.availableActions.map((a: any) => a.action);
    // The failure this replaces: the old modal offered "Approve verification"
    // on a provider that was already verified.
    expect(names).not.toContain('approve');
    expect(names.sort()).toEqual(['block', 'reject', 'revoke', 'suspend']);
  });

  it('refuses an action that is not legal from the current state', async () => {
    const { mfa, provider } = await setup();
    const res = await act(mfa, provider.providerId!, 'reinstate', REASON).expect(409);
    expect(res.body.error?.message ?? res.body.message).toMatch(/not available/i);
  });

  it('tells the caller which actions each state carries, not a fixed list', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'reject', REASON).expect(200);

    const rejected = await detail(admin.token, provider.providerId!).expect(200);
    expect(rejected.body.state).toBe('rejected');
    const names = rejected.body.availableActions.map((a: any) => a.action).sort();
    expect(names).toEqual(['block', 'overturn', 'reopen', 'suspend']);
  });
});

describe('provider lifecycle — reasons and audit', () => {
  it('refuses a destructive action with no reason', async () => {
    const { mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'reject').expect(400);
  });

  it('refuses a reason too short to mean anything', async () => {
    const { mfa, provider } = await setup();
    const res = await act(mfa, provider.providerId!, 'reject', 'nope').expect(400);
    expect(res.body.error?.message ?? res.body.message).toMatch(/at least/i);
  });

  it('accepts approval with no reason, because approving needs no excuse', async () => {
    const { mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);
  });

  it('records every transition in the provider history with its reason', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);
    await act(mfa, provider.providerId!, 'revoke', 'Insurance certificate expired last month.')
      .expect(200);

    const after = await detail(admin.token, provider.providerId!).expect(200);
    expect(after.body.history).toHaveLength(2);
    // Newest first.
    expect(after.body.history[0]).toMatchObject({
      action: 'revoke', fromStatus: 'verified', toStatus: 'pending',
      reason: 'Insurance certificate expired last month.',
    });
    expect(after.body.history[0].actorName).toBe('Test Admin');
    expect(after.body.history[1]).toMatchObject({ action: 'approve', toStatus: 'verified' });
  });

  it('keeps the audit action names existing filters already query', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);

    const logs = await request(app)
      .get('/api/v1/admin/audit-logs')
      .query({ action: 'admin.provider_verification' })
      .set(auth(admin.token)).expect(200);

    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0].metadata.action).toBe('approve');
    expect(logs.body.data[0].entityId).toBe(provider.providerId);
  });

  it('leaves the audit chain verifiable after a run of lifecycle actions', async () => {
    const { mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);
    await act(mfa, provider.providerId!, 'revoke', REASON).expect(200);
    await act(mfa, provider.providerId!, 'reject', REASON).expect(200);
    await act(mfa, provider.providerId!, 'overturn', 'Register was out of date; licence is valid.')
      .expect(200);
    await act(mfa, provider.providerId!, 'suspend', REASON).expect(200);
    await act(mfa, provider.providerId!, 'reinstate', 'Dispute resolved in the provider favour.')
      .expect(200);

    // Metadata key order differs from what jsonb hands back, which is exactly
    // what used to make this report a break with nothing tampered with.
    const integrity = await request(app)
      .get('/api/v1/admin/audit-logs/integrity').set(auth(mfa)).expect(200);
    expect(integrity.body.ok).toBe(true);
  });
});

describe('provider lifecycle — the two axes stay independent', () => {
  it('preserves verification across a suspension and restores it on reinstatement', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);
    await publishProvider(provider.providerId!);

    const suspended = await act(mfa, provider.providerId!, 'suspend', REASON).expect(200);
    expect(suspended.body.state).toBe('suspended');
    // The badge is not lost — the account is stopped, not un-checked.
    expect(suspended.body.verificationStatus).toBe('verified');

    const while_stopped = await detail(admin.token, provider.providerId!).expect(200);
    expect(while_stopped.body.isPublished).toBe(false);

    const back = await act(mfa, provider.providerId!, 'reinstate', 'Dispute resolved.').expect(200);
    expect(back.body.state).toBe('verified');

    const after = await detail(admin.token, provider.providerId!).expect(200);
    // Reinstating restores what the suspension took down. Leaving them
    // unlisted after "your account is active again" is a half-reversal.
    expect(after.body.isPublished).toBe(true);
  });

  it('does not republish a provider that was already unlisted before suspension', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);
    // Never published.
    await act(mfa, provider.providerId!, 'suspend', REASON).expect(200);
    await act(mfa, provider.providerId!, 'reinstate', 'Dispute resolved.').expect(200);

    const after = await detail(admin.token, provider.providerId!).expect(200);
    expect(after.body.isPublished).toBe(false);
  });

  it('revoking a badge does not take the listings down', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);
    await publishProvider(provider.providerId!);

    await act(mfa, provider.providerId!, 'revoke', REASON).expect(200);

    const after = await detail(admin.token, provider.providerId!).expect(200);
    expect(after.body.state).toBe('pending');
    // Losing a trust signal is not the same as losing the right to trade.
    expect(after.body.isPublished).toBe(true);
  });

  it('rejecting does take the listings down', async () => {
    const { admin, mfa, provider } = await setup();
    await publishProvider(provider.providerId!, false);

    await act(mfa, provider.providerId!, 'reject', REASON).expect(200);

    const after = await detail(admin.token, provider.providerId!).expect(200);
    expect(after.body.isPublished).toBe(false);
  });
});

describe('provider lifecycle — blocking', () => {
  it('ends every session and refuses the refresh token', async () => {
    const { mfa, provider } = await setup();

    await request(app).get('/api/v1/provider/profile').set(auth(provider.token)).expect(200);

    await act(mfa, provider.providerId!, 'block', 'Fraudulent invoices raised against two clients.')
      .expect(200);

    // The access token stops working immediately, not when it expires.
    await request(app).get('/api/v1/provider/profile').set(auth(provider.token)).expect(403);
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: provider.refreshToken })
      .expect(401);
  });

  it('offers only unblocking afterwards, and it needs a reason', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'block', 'Fraudulent invoices raised.').expect(200);

    const blocked = await detail(admin.token, provider.providerId!).expect(200);
    expect(blocked.body.state).toBe('blocked');
    expect(blocked.body.availableActions.map((a: any) => a.action)).toEqual(['unblock']);

    await act(mfa, provider.providerId!, 'unblock').expect(400);
    await act(mfa, provider.providerId!, 'unblock', 'Chargebacks were the processor error.')
      .expect(200);

    const after = await detail(admin.token, provider.providerId!).expect(200);
    expect(after.body.state).toBe('unverified');
    // The block is not erased by being reversed.
    expect(after.body.history.map((h: any) => h.action)).toEqual(['unblock', 'block']);
  });
});

describe('provider lifecycle — access control', () => {
  it('refuses a state change without a two-factor session', async () => {
    const { admin, provider } = await setup();
    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/actions`)
      .set(auth(admin.token))
      .send({ action: 'approve' })
      .expect(403);
  });

  it('refuses everything to a non-admin', async () => {
    const { provider } = await setup();
    await request(app)
      .get(`/api/v1/admin/providers/${provider.providerId}`)
      .set(auth(provider.token))
      .expect(403);
  });

  it('rejects an action name it does not know', async () => {
    const { mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'delete_everything', REASON).expect(422);
  });
});

describe('provider lifecycle — the queue', () => {
  it('filters by the merged state, not by verification alone', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);
    await act(mfa, provider.providerId!, 'suspend', REASON).expect(200);

    const verified = await request(app)
      .get('/api/v1/admin/providers').query({ state: 'verified' })
      .set(auth(admin.token)).expect(200);
    // Still verified on the verification axis, but suspended is what the
    // admin needs to see. The old filter would have listed it under Verified.
    expect(verified.body.data).toHaveLength(0);

    const suspended = await request(app)
      .get('/api/v1/admin/providers').query({ state: 'suspended' })
      .set(auth(admin.token)).expect(200);
    expect(suspended.body.data).toHaveLength(1);
    expect(suspended.body.data[0].verificationStatus).toBe('verified');
  });

  it('orders the review queue oldest first', async () => {
    const admin = await createAdmin(app);
    const mfa = await elevateToMfa(admin);

    const first = await registerUser(app, {
      role: 'provider', email: 'older@test.local', businessName: 'Older Co',
    });
    const second = await registerUser(app, {
      role: 'provider', email: 'newer@test.local', businessName: 'Newer Co',
    });
    await act(mfa, first.providerId!, 'reopen').expect(200);
    await act(mfa, second.providerId!, 'reopen').expect(200);

    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    await db.query(
      `UPDATE providers SET verification_requested_at = now() - interval '20 days' WHERE id = $1`,
      [second.providerId],
    );

    const queue = await request(app)
      .get('/api/v1/admin/providers').query({ state: 'pending', sort: 'waiting' })
      .set(auth(admin.token)).expect(200);

    // Newer Co has been waiting longest by the clock that matters, so it wins
    // regardless of when the account was created.
    expect(queue.body.data.map((p: any) => p.businessName)).toEqual(['Newer Co', 'Older Co']);
  });

  it('searches business name, owner name and owner email', async () => {
    const { admin } = await setup();
    for (const q of ['Lifecycle', 'lifecycle@test.local', 'Test Provider']) {
      const res = await request(app)
        .get('/api/v1/admin/providers').query({ q })
        .set(auth(admin.token)).expect(200);
      expect(res.body.data, q).toHaveLength(1);
    }

    const miss = await request(app)
      .get('/api/v1/admin/providers').query({ q: 'nothing-matches-this' })
      .set(auth(admin.token)).expect(200);
    expect(miss.body.data).toHaveLength(0);
  });

  it('counts each provider in exactly one bucket on the dashboard', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);
    await act(mfa, provider.providerId!, 'suspend', REASON).expect(200);

    const metrics = await request(app)
      .get('/api/v1/admin/metrics').set(auth(admin.token)).expect(200);

    const p = metrics.body.providers;
    expect(p.suspended).toBe(1);
    expect(p.verified).toBe(0);
    const buckets = p.pending + p.infoRequested + p.verified + p.rejected
      + p.unverified + p.suspended + p.blocked;
    expect(buckets).toBe(p.total);
  });

  it('surfaces the waiting queue and recent activity on the dashboard', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'reopen').expect(200);

    const metrics = await request(app)
      .get('/api/v1/admin/metrics').set(auth(admin.token)).expect(200);

    expect(metrics.body.reviewQueue).toHaveLength(1);
    expect(metrics.body.reviewQueue[0]).toMatchObject({
      businessName: 'Lifecycle Co', state: 'pending',
    });
    expect(metrics.body.recentActivity[0].action).toBe('admin.provider_verification');
  });
});

describe('provider lifecycle — the status-based endpoint still works', () => {
  it('translates a target status into the action legal from here', async () => {
    const { mfa, provider } = await setup();

    const res = await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/verification`)
      .set(auth(mfa))
      .send({ status: 'verified', note: 'Licence and insurance checked.' })
      .expect(200);
    expect(res.body.verificationStatus).toBe('verified');
    expect(res.body.state).toBe('verified');
  });

  it('routes a status that means different things from different states', async () => {
    const { admin, mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);

    // From verified, "pending" is a revocation and therefore needs a reason.
    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/verification`)
      .set(auth(mfa)).send({ status: 'pending' }).expect(400);

    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/verification`)
      .set(auth(mfa)).send({ status: 'pending', note: REASON }).expect(200);

    const after = await detail(admin.token, provider.providerId!).expect(200);
    expect(after.body.history[0].action).toBe('revoke');
  });

  it('declines a transition it has no legal action for', async () => {
    const { mfa, provider } = await setup();
    await act(mfa, provider.providerId!, 'approve').expect(200);

    await request(app)
      .post(`/api/v1/admin/providers/${provider.providerId}/verification`)
      .set(auth(mfa)).send({ status: 'info_requested', note: REASON })
      .expect(400);
  });
});

describe('account status endpoint', () => {
  it('routes a provider through the lifecycle so the history is written', async () => {
    const { admin, mfa, provider } = await setup();

    await request(app)
      .post(`/api/v1/admin/users/${provider.id}/status`)
      .set(auth(mfa))
      .send({ status: 'suspended', reason: 'Repeated policy violations after two warnings.' })
      .expect(200);

    const after = await detail(admin.token, provider.providerId!).expect(200);
    expect(after.body.state).toBe('suspended');
    expect(after.body.history[0].action).toBe('suspend');
  });

  it('supports blocking and unblocking', async () => {
    const { mfa, provider } = await setup();

    await request(app)
      .post(`/api/v1/admin/users/${provider.id}/status`)
      .set(auth(mfa)).send({ status: 'blocked', reason: 'Fraudulent invoices raised.' })
      .expect(200);

    const blocked = await request(app)
      .get('/api/v1/admin/users').query({ status: 'blocked' })
      .set(auth(mfa)).expect(200);
    expect(blocked.body.data).toHaveLength(1);
    expect(blocked.body.data[0].statusReason).toBe('Fraudulent invoices raised.');

    await request(app)
      .post(`/api/v1/admin/users/${provider.id}/status`)
      .set(auth(mfa)).send({ status: 'active', reason: 'Chargebacks were a processor error.' })
      .expect(200);
  });

  it('treats a repeat of the current status as a no-op, not a conflict', async () => {
    const { mfa, provider } = await setup();
    const body = { status: 'suspended', reason: 'Repeated policy violations after warnings.' };

    await request(app)
      .post(`/api/v1/admin/users/${provider.id}/status`).set(auth(mfa)).send(body).expect(200);
    // A double-submit must not become an error the operator has to interpret.
    await request(app)
      .post(`/api/v1/admin/users/${provider.id}/status`).set(auth(mfa)).send(body).expect(200);
  });

  it('still refuses an admin changing their own status', async () => {
    const { admin, mfa } = await setup();
    await request(app)
      .post(`/api/v1/admin/users/${admin.id}/status`)
      .set(auth(mfa)).send({ status: 'suspended', reason: 'Testing self lockout guard.' })
      .expect(400);
  });
});

describe('session auth level survives a token refresh', () => {
  it('keeps an MFA session elevated after rotation', async () => {
    // The bug this covers: /auth/refresh re-signed the access token without
    // the aal claim, so an MFA-elevated admin silently dropped to aal1 one
    // token lifetime after signing in and every admin write started 403ing.
    const admin = await createAdmin(app, 'mfa-admin@test.local');
    const { getDb } = await import('../../src/db/index.js');
    const db = await getDb();
    await db.query('UPDATE refresh_tokens SET aal = $2 WHERE user_id = $1', [admin.id, 'mfa']);

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: admin.refreshToken })
      .expect(200);

    const me = await request(app)
      .get('/api/v1/auth/me').set(auth(refreshed.body.accessToken)).expect(200);
    expect(me.body.sessionAal).toBe('mfa');

    // And it stays elevated across a second rotation.
    const again = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(200);
    const me2 = await request(app)
      .get('/api/v1/auth/me').set(auth(again.body.accessToken)).expect(200);
    expect(me2.body.sessionAal).toBe('mfa');
  });

  it('does not elevate a session that never passed a challenge', async () => {
    const admin = await createAdmin(app, 'plain-admin@test.local');
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: admin.refreshToken })
      .expect(200);

    const me = await request(app)
      .get('/api/v1/auth/me').set(auth(refreshed.body.accessToken)).expect(200);
    expect(me.body.sessionAal).toBe('aal1');
  });
});
