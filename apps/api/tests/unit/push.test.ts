import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendPush, isExpoToken, type PushMessage } from '../../src/lib/push.js';

/**
 * The switch is read at call time, like ADMIN_MFA_REQUIRED, so a case can flip
 * it without reloading the config module. Restored after each one — the suite
 * shares a single process, and a leaked `true` here would send the rest of the
 * tests at Expo for real.
 */
const envModule = async () => (await import('../../src/config/env.js')).env;

let original: boolean;
let fetchSpy: ReturnType<typeof vi.fn> | null = null;

beforeEach(async () => {
  original = (await envModule()).PUSH_ENABLED;
});

afterEach(async () => {
  const env = (await envModule()) as { PUSH_ENABLED: boolean };
  env.PUSH_ENABLED = original;
  if (fetchSpy) {
    vi.unstubAllGlobals();
    fetchSpy = null;
  }
});

const setEnabled = async (value: boolean) => {
  const env = (await envModule()) as { PUSH_ENABLED: boolean };
  env.PUSH_ENABLED = value;
};

/** Replaces the network with a recorder that replies with the given tickets. */
function stubExpo(reply: unknown, ok = true) {
  fetchSpy = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => reply,
    text: async () => JSON.stringify(reply),
  }));
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

const token = (n: number) => `ExponentPushToken[token-${n}]`;

const message = (n: number): PushMessage => ({
  token: token(n),
  title: 'New quote request',
  body: 'Ana Reyes — leaking water heater',
  data: { jobId: 'job-1' },
  badge: 3,
});

/* ========================================================================== */
/* Token shape                                                                */
/* ========================================================================== */

describe('token recognition', () => {
  it('accepts both spellings Expo has issued', () => {
    expect(isExpoToken('ExponentPushToken[abc123]')).toBe(true);
    expect(isExpoToken('ExpoPushToken[abc123]')).toBe(true);
  });

  it('rejects anything that was not minted by the app', () => {
    // A raw FCM/APNs token cannot be delivered by this client, and silently
    // passing it to Expo would produce an error ticket per notification for
    // ever rather than one pruned row.
    expect(isExpoToken('fGf1...rawFcmToken')).toBe(false);
    expect(isExpoToken('')).toBe(false);
    expect(isExpoToken('ExponentPushToken[]')).toBe(false);
  });
});

/* ========================================================================== */
/* Simulation                                                                 */
/* ========================================================================== */

describe('simulation', () => {
  it('reports success without touching the network when disabled', async () => {
    await setEnabled(false);
    const spy = stubExpo({ data: [] });

    const outcomes = await sendPush([message(1), message(2)]);

    expect(spy).not.toHaveBeenCalled();
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.status === 'ok')).toBe(true);
    expect(outcomes.every((o) => o.status === 'ok' && o.simulated)).toBe(true);
  });

  it('still rejects a malformed token while simulating', async () => {
    await setEnabled(false);
    const outcomes = await sendPush([{ ...message(1), token: 'not-a-token' }]);
    expect(outcomes[0].status).toBe('error');
  });
});

/* ========================================================================== */
/* Delivery                                                                   */
/* ========================================================================== */

describe('delivery', () => {
  it('sends the title, body, data and badge Expo expects', async () => {
    await setEnabled(true);
    const spy = stubExpo({ data: [{ status: 'ok', id: 'ticket-1' }] });

    await sendPush([message(1)]);

    expect(spy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((spy.mock.calls[0][1] as { body: string }).body);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      to: token(1),
      title: 'New quote request',
      body: 'Ana Reyes — leaking water heater',
      data: { jobId: 'job-1' },
      badge: 3,
      priority: 'high',
    });
  });

  it('omits the badge when the caller did not set one', async () => {
    await setEnabled(true);
    const spy = stubExpo({ data: [{ status: 'ok', id: 't' }] });

    const { badge, ...noBadge } = message(1);
    void badge;
    await sendPush([noBadge]);

    const body = JSON.parse((spy.mock.calls[0][1] as { body: string }).body);
    expect(body[0]).not.toHaveProperty('badge');
  });

  it('splits a batch larger than Expo accepts', async () => {
    await setEnabled(true);
    const spy = stubExpo({ data: Array.from({ length: 100 }, () => ({ status: 'ok', id: 't' })) });

    const messages = Array.from({ length: 150 }, (_, i) => message(i));
    const outcomes = await sendPush(messages);

    // 150 messages, 100 to a request.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(outcomes).toHaveLength(150);
  });

  it('handles the single-object reply Expo sends for one message', async () => {
    await setEnabled(true);
    stubExpo({ data: { status: 'ok', id: 'ticket-solo' } });

    const outcomes = await sendPush([message(1)]);
    expect(outcomes[0]).toMatchObject({ status: 'ok', id: 'ticket-solo' });
  });
});

/* ========================================================================== */
/* Failure                                                                    */
/* ========================================================================== */

describe('failure', () => {
  it('reports an uninstalled app as unregistered so the row can be dropped', async () => {
    await setEnabled(true);
    stubExpo({
      data: [{ status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }],
    });

    const outcomes = await sendPush([message(1)]);
    expect(outcomes[0]).toEqual({ token: token(1), status: 'unregistered' });
  });

  it('keeps a soft error distinct from a dead token', async () => {
    await setEnabled(true);
    stubExpo({
      data: [{ status: 'error', message: 'MessageRateExceeded', details: { error: 'MessageRateExceeded' } }],
    });

    const outcomes = await sendPush([message(1)]);
    expect(outcomes[0].status).toBe('error');
  });

  it('does not fail the whole batch for one dead handset', async () => {
    await setEnabled(true);
    stubExpo({
      data: [
        { status: 'ok', id: 'ticket-1' },
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok', id: 'ticket-3' },
      ],
    });

    const outcomes = await sendPush([message(1), message(2), message(3)]);

    expect(outcomes.map((o) => o.status)).toEqual(['ok', 'unregistered', 'ok']);
  });

  it('throws on a transport failure, because the queue can retry that', async () => {
    await setEnabled(true);
    stubExpo({ error: 'upstream' }, false);

    await expect(sendPush([message(1)])).rejects.toThrow(/Expo push 500/);
  });

  it('treats a short reply as a soft error rather than losing the token', async () => {
    await setEnabled(true);
    stubExpo({ data: [] });

    const outcomes = await sendPush([message(1)]);
    expect(outcomes[0]).toMatchObject({ status: 'error' });
  });

  it('sends nothing at all for an empty batch', async () => {
    await setEnabled(true);
    const spy = stubExpo({ data: [] });

    expect(await sendPush([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
