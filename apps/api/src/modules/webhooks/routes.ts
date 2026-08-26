import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../../db/index.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { logger } from '../../lib/logger.js';
import { forbidden, badRequest } from '../../lib/errors.js';
import * as billing from '../billing/service.js';
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
