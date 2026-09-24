import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Push delivery, through Expo.
 *
 * Expo rather than APNs and FCM directly, because the app is an Expo build and
 * the tokens it produces are Expo tokens. Talking to Apple and Google straight
 * would mean two credential sets, two payload shapes and two sets of failure
 * semantics to reach the same handsets — worth doing when there is a reason,
 * which today there is not. `device_tokens.push_service` records the choice so
 * changing it later is a migration rather than a rewrite.
 *
 * Like `modules/whatsapp/client.ts`, this simulates when the integration is
 * switched off, so the whole path — token lookup, chunking, receipt handling,
 * pruning dead tokens — is exercisable in tests and in development without
 * reaching the network. Unlike WhatsApp, the default is **on**: Expo push
 * needs no account and no credentials, so there is nothing to configure and a
 * default of off would just reproduce the bug this replaces.
 */

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
const CHUNK_SIZE = 100;

const REQUEST_TIMEOUT_MS = 10_000;

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Routed on by the app's tap handler; keep it to ids, never to secrets. */
  data?: Record<string, unknown>;
  /** App icon badge, normally the recipient's unread count. */
  badge?: number;
}

export type PushOutcome =
  | { token: string; status: 'ok'; id: string; simulated: boolean }
  /**
   * The token is dead for good: the app was uninstalled, or the token was
   * replaced. Expo reports this as `DeviceNotRegistered`, and their own
   * guidance is to stop sending to it — so the caller deletes the row rather
   * than counting a failure against it.
   */
  | { token: string; status: 'unregistered' }
  | { token: string; status: 'error'; message: string };

/** Expo's own token shape. Anything else was not minted by the app. */
export function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/.test(token);
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sends a batch and reports what happened to each token.
 *
 * Never throws for a per-token problem: one uninstalled handset must not fail
 * the job and drag every other recipient of the same notification through a
 * retry. A transport failure — the whole request timing out or Expo returning
 * 5xx — does throw, because that is worth retrying and the queue already knows
 * how.
 */
export async function sendPush(messages: PushMessage[]): Promise<PushOutcome[]> {
  if (!messages.length) return [];

  // Anything that is not an Expo token cannot be delivered by this client.
  // Reported rather than dropped, so the caller can prune it.
  const outcomes: PushOutcome[] = [];
  const deliverable = messages.filter((m) => {
    if (isExpoToken(m.token)) return true;
    outcomes.push({ token: m.token, status: 'error', message: 'not an Expo push token' });
    return false;
  });

  if (!env.PUSH_ENABLED) {
    logger.info({ count: deliverable.length }, 'push simulated (PUSH_ENABLED is false)');
    for (const m of deliverable) {
      outcomes.push({
        token: m.token,
        status: 'ok',
        id: `sim_${crypto.randomBytes(10).toString('hex')}`,
        simulated: true,
      });
    }
    return outcomes;
  }

  for (const batch of chunk(deliverable, CHUNK_SIZE)) {
    const tickets = await postBatch(batch);

    batch.forEach((message, index) => {
      const ticket = tickets[index];
      // A short response is Expo's problem, not this token's. Treated as a
      // soft error so the token survives to be tried again.
      if (!ticket) {
        outcomes.push({ token: message.token, status: 'error', message: 'no ticket returned' });
        return;
      }
      if (ticket.status === 'ok') {
        outcomes.push({
          token: message.token,
          status: 'ok',
          id: ticket.id ?? 'unknown',
          simulated: false,
        });
        return;
      }
      if (ticket.details?.error === 'DeviceNotRegistered') {
        outcomes.push({ token: message.token, status: 'unregistered' });
        return;
      }
      outcomes.push({
        token: message.token,
        status: 'error',
        message: ticket.message ?? ticket.details?.error ?? 'unknown push error',
      });
    });
  }

  return outcomes;
}

async function postBatch(batch: PushMessage[]): Promise<ExpoTicket[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(EXPO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Optional. Expo's "enhanced security" mode rejects unauthenticated
        // sends for projects that have turned it on; without it this header
        // is simply absent and sending works as before.
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(
        batch.map((m) => ({
          to: m.token,
          title: m.title,
          body: m.body,
          data: m.data ?? {},
          sound: 'default',
          ...(typeof m.badge === 'number' ? { badge: m.badge } : {}),
          // Ruvik notifications are about money and appointments: worth
          // waking the device for, and worth not being batched by the OS.
          priority: 'high',
          channelId: 'default',
        })),
      ),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Expo push ${res.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await res.json()) as { data?: ExpoTicket[] | ExpoTicket };
    // Expo returns an array for a batch and an object for a single message.
    if (Array.isArray(body.data)) return body.data;
    return body.data ? [body.data] : [];
  } finally {
    clearTimeout(timeout);
  }
}
