import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../../db/index.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { logger } from '../../lib/logger.js';
import { forbidden, badRequest } from '../../lib/errors.js';
import * as billing from '../billing/service.js';
import * as stripe from '../billing/stripe/index.js';
import * as whatsapp from '../whatsapp/service.js';
import { verifyWebhookSignature } from '../whatsapp/client.js';
import { writeAudit } from '../../lib/audit.js';
import { rateLimit } from '../../middleware/rateLimit.js';

export const webhooksRouter = Router();

/** Raw body is required for signature verification; see app.ts for the parser. */
function rawBodyOf(req: Request): Buffer {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) throw badRequest('Missing request body.');
  return raw;
}

const webhookLimiter = rateLimit({ name: 'webhook', windowSeconds: 60, max: 600 });

/**
 * Records the event before processing so a replay is rejected by the unique
 * index rather than charged twice. Returns false when already seen.
 */
async function recordEvent(
  source: 'billing' | 'whatsapp',
  externalId: string,
  eventType: string,
  payload: unknown,
): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO webhook_events (source, external_id, event_type, signature_verified, payload)
     VALUES ($1,$2,$3,true,$4)
     ON CONFLICT (source, external_id) DO NOTHING
     RETURNING id`,
    [source, externalId, eventType, JSON.stringify(payload)],
  );
  return rows.length > 0;
}

/**
 * Records the event and says whether this delivery should process it.
 *
 * `recordEvent` above returns false for anything already in the table, which
 * is right for a first delivery but wrong for a retry: an event that failed
 * mid-processing is already recorded, so Stripe's retry would be dismissed as
 * a duplicate and the work would never complete. This claims the row instead —
 * a fresh insert or an existing row that never reached `processed_at` is
 * claimable, and one that did is not.
 *
 * Concurrent deliveries of the same event can both claim it, because
 * `processed_at` is only set after the work finishes. That is tolerated rather
 * than locked against: every handler in `stripe/sync.ts` is idempotent, and
 * holding a transaction open across the whole apply would be worse.
 */
async function claimEvent(
  source: 'billing' | 'whatsapp' | 'stripe',
  externalId: string,
  eventType: string,
  payload: unknown,
): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO webhook_events (source, external_id, event_type, signature_verified, payload)
     VALUES ($1,$2,$3,true,$4)
     ON CONFLICT (source, external_id) DO UPDATE
       SET payload = EXCLUDED.payload
       WHERE webhook_events.processed_at IS NULL
     RETURNING id`,
    [source, externalId, eventType, JSON.stringify(payload)],
  );
  return rows.length > 0;
}

/**
 * Records that an event failed, without marking it done.
 *
 * `markProcessed(source, id, error)` stamps `processed_at` whatever happened,
 * which is what makes a failed event unclaimable by `claimEvent` and so
 * unretryable. Leaving the timestamp null is the whole point: the row keeps the
 * error for diagnosis and the next delivery can pick the work back up. An event
 * Stripe eventually stops retrying stays here with a null `processed_at`, which
 * is exactly the row somebody investigating wants to find.
 */
async function markFailed(source: string, externalId: string, error: string) {
  const db = await getDb();
  await db.query(
    `UPDATE webhook_events SET error = $3 WHERE source = $1 AND external_id = $2`,
    [source, externalId, error],
  );
}

async function markProcessed(source: string, externalId: string, error?: string) {
  const db = await getDb();
  await db.query(
    `UPDATE webhook_events SET processed_at = now(), error = $3
      WHERE source = $1 AND external_id = $2`,
    [source, externalId, error ?? null],
  );
}

/* ------------------------------- billing ---------------------------------- */

/**
 * Signature scheme: `t=<unix>,v1=<hmac-sha256 of "t.rawBody">`.
 * The timestamp is inside the signed payload and checked against a 5-minute
 * window, so a captured request cannot be replayed later.
 */
function verifyBillingSignature(raw: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const idx = kv.indexOf('=');
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const expected = crypto
    .createHmac('sha256', env.BILLING_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw.toString('utf8')}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

webhooksRouter.post(
  '/billing',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const raw = rawBodyOf(req);
    if (!verifyBillingSignature(raw, req.headers['x-ruvik-signature'] as string | undefined)) {
      logger.warn({ ip: req.ip }, 'billing webhook signature rejected');
      throw forbidden('Invalid webhook signature.');
    }

    const event = JSON.parse(raw.toString('utf8')) as {
      id?: string;
      type?: string;
      data?: { reference?: string; amountCents?: number; reason?: string };
    };
    if (!event.id || !event.type) throw badRequest('Malformed webhook event.');

    const isNew = await recordEvent('billing', event.id, event.type, event);
    if (!isNew) {
      // Already handled — acknowledge so the sender stops retrying.
      return res.json({ received: true, duplicate: true });
    }

    try {
      switch (event.type) {
        case 'payment.succeeded':
          if (!event.data?.reference) throw badRequest('Missing payment reference.');
          await billing.activateSubscription(event.data.reference, event.data.amountCents ?? 0);
          break;
        case 'payment.failed':
          if (!event.data?.reference) throw badRequest('Missing payment reference.');
          await billing.markPaymentFailed(event.data.reference, event.data.reason ?? 'unknown');
          break;
        default:
          logger.info({ type: event.type }, 'unhandled billing webhook type');
      }
      await markProcessed('billing', event.id);
      await writeAudit({
        actorRole: 'system', action: 'webhook.billing_processed',
        entityType: 'webhook_event', entityId: event.id, metadata: { type: event.type },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markProcessed('billing', event.id, message);
      throw err;
    }

    res.json({ received: true });
  }),
);

/* -------------------------------- Stripe ---------------------------------- */

/**
 * Stripe's own webhook, recorded under its own `source` so it dedupes
 * separately from the manual billing webhook above and the two can be told
 * apart when reading `webhook_events`. Migration 006 added `'stripe'` to that
 * column's CHECK; this is the endpoint that finally writes it.
 *
 * Returns 200 for an event Stripe sends that we do not handle. A 4xx would put
 * the endpoint into Stripe's failure statistics and eventually get it disabled,
 * for events we deliberately ignore.
 */
webhooksRouter.post(
  '/stripe',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    if (!stripe.isStripeConfigured()) {
      // Nothing is configured, so nothing can be verified. Refusing outright is
      // better than accepting unverifiable events into the ledger.
      throw forbidden('Stripe billing is not enabled on this deployment.');
    }
    const { webhookSecret } = stripe.requireStripe();
    const raw = rawBodyOf(req);

    const check = stripe.verifyStripeSignature(
      raw,
      req.headers['stripe-signature'] as string | undefined,
      webhookSecret,
    );
    if (!check.ok) {
      logger.warn({ ip: req.ip, reason: check.reason }, 'stripe webhook signature rejected');
      throw forbidden('Invalid webhook signature.');
    }

    const event = JSON.parse(raw.toString('utf8')) as stripe.StripeEventEnvelope;
    if (!event.id || !event.type) throw badRequest('Malformed webhook event.');

    const intent = stripe.intentFor(event.type);
    if (!intent) {
      logger.info({ type: event.type }, 'unhandled stripe webhook type');
      return res.json({ received: true, handled: false });
    }

    // Claimed before processing, so a redelivery of something already done is
    // dropped while a retry of something that failed is let through.
    const claimed = await claimEvent('stripe', event.id, event.type, event);
    if (!claimed) return res.json({ received: true, duplicate: true });

    try {
      const applied = await stripe.applyIntent(intent, event);
      await markProcessed('stripe', event.id);
      logger.info(
        { type: event.type, intent, outcome: applied.outcome, detail: applied.detail },
        'stripe webhook processed',
      );
      res.json({ received: true, handled: true, outcome: applied.outcome });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Error recorded, `processed_at` left null: that is what lets the retry
      // claim the row instead of being dismissed as a duplicate.
      await markFailed('stripe', event.id, message);
      // Rethrown so Stripe retries.
      throw err;
    }
  }),
);

/* ------------------------------- WhatsApp --------------------------------- */

/** Meta's subscription handshake. */
webhooksRouter.get(
  '/whatsapp',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(String(challenge ?? ''));
    }
    throw forbidden('Verification failed.');
  }),
);

webhooksRouter.post(
  '/whatsapp',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const raw = rawBodyOf(req);
    if (!verifyWebhookSignature(raw, req.headers['x-hub-signature-256'] as string | undefined)) {
      logger.warn({ ip: req.ip }, 'whatsapp webhook signature rejected');
      throw forbidden('Invalid webhook signature.');
    }

    const payload = JSON.parse(raw.toString('utf8'));
    // Meta batches events; each entry carries its own id.
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    for (const entry of entries) {
      const externalId = String(entry.id ?? crypto.randomUUID());
      const isNew = await recordEvent('whatsapp', externalId, 'message_event', entry);
      if (!isNew) continue;

      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};

        for (const status of value.statuses ?? []) {
          await whatsapp.applyStatusUpdate(
            String(status.id),
            String(status.status),
            status.errors?.[0]?.code ? String(status.errors[0].code) : undefined,
          );
        }

        for (const message of value.messages ?? []) {
          if (message.type === 'text' && message.text?.body) {
            await whatsapp.handleInboundMessage(`+${String(message.from)}`, String(message.text.body));
          }
        }
      }
      await markProcessed('whatsapp', externalId);
    }

    // Always 200: a non-2xx makes Meta retry the whole batch.
    res.json({ received: true });
  }),
);
