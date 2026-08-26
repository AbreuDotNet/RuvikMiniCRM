import { getDb } from '../../db/index.js';
import { sendTemplate, maskPhone } from './client.js';
import { hmac, randomToken } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { writeAudit } from '../../lib/audit.js';
import { signStorageUrl } from '../../lib/storage.js';

/**
 * Approved message templates. WhatsApp policy requires business-initiated
 * messages outside the 24-hour service window to use a pre-approved template,
 * so the platform can only send what is listed here.
 */
export const TEMPLATES = {
  quote_ready: {
    name: 'ruvik_quote_ready',
    language: 'en',
    variables: ['customer_name', 'business_name', 'quote_number'],
    attachesDocument: true,
  },
  invoice_ready: {
    name: 'ruvik_invoice_ready',
    language: 'en',
    variables: ['customer_name', 'business_name', 'invoice_number'],
    attachesDocument: true,
  },
  job_scheduled: {
    name: 'ruvik_job_scheduled',
    language: 'en',
    variables: ['customer_name', 'business_name', 'scheduled_date'],
    attachesDocument: false,
  },
  payment_reminder: {
    name: 'ruvik_payment_reminder',
    language: 'en',
    variables: ['customer_name', 'invoice_number', 'amount'],
    attachesDocument: false,
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export interface ConsentState {
  optedIn: boolean;
  phone: string | null;
  optInAt: string | null;
  optOutAt: string | null;
}

export async function getConsent(userId: string): Promise<ConsentState> {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT whatsapp_opt_in, whatsapp_phone_e164, whatsapp_opt_in_at, whatsapp_opt_out_at
       FROM users WHERE id = $1`,
    [userId],
  );
  const u = rows[0];
  return {
    optedIn: Boolean(u?.whatsapp_opt_in),
    phone: u?.whatsapp_phone_e164 ?? null,
    optInAt: u?.whatsapp_opt_in_at ?? null,
    optOutAt: u?.whatsapp_opt_out_at ?? null,
  };
}

/**
 * Records explicit opt-in. The consent event is appended to an immutable log
 * with the source and IP, which is the evidence a WhatsApp policy audit asks for.
 */
export async function optIn(
  userId: string,
  phone: string,
  source: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<ConsentState> {
  const db = await getDb();
  await db.tx(async (c) => {
    await c.query(
      `UPDATE users SET whatsapp_opt_in = true, whatsapp_phone_e164 = $2,
              whatsapp_opt_in_at = now(), whatsapp_opt_out_at = NULL
        WHERE id = $1`,
      [userId, phone],
    );
    await c.query(
      `INSERT INTO whatsapp_consents (user_id, phone_e164, action, source, ip, user_agent)
       VALUES ($1,$2,'opt_in',$3,$4,$5)`,
      [userId, phone, source, ctx.ip ?? null, ctx.userAgent ?? null],
    );
    await writeAudit({
      actorUserId: userId, action: 'whatsapp.opt_in', entityType: 'user', entityId: userId,
      ip: ctx.ip, userAgent: ctx.userAgent, metadata: { source, phone: maskPhone(phone) },
    }, c);
  });
  return getConsent(userId);
}

/** Opt-out is immediate and unconditional. */
export async function optOut(
  userId: string,
  source: string,
  ctx: { ip?: string; userAgent?: string } = {},
): Promise<ConsentState> {
  const db = await getDb();
  await db.tx(async (c) => {
    const { rows } = await c.query<{ whatsapp_phone_e164: string | null }>(
      'SELECT whatsapp_phone_e164 FROM users WHERE id = $1',
      [userId],
    );
    await c.query(
      `UPDATE users SET whatsapp_opt_in = false, whatsapp_opt_out_at = now() WHERE id = $1`,
      [userId],
    );
    await c.query(
      `INSERT INTO whatsapp_consents (user_id, phone_e164, action, source, ip, user_agent)
       VALUES ($1,$2,'opt_out',$3,$4,$5)`,
      [userId, rows[0]?.whatsapp_phone_e164 ?? 'unknown', source, ctx.ip ?? null, ctx.userAgent ?? null],
    );
    await writeAudit({
      actorUserId: userId, action: 'whatsapp.opt_out', entityType: 'user', entityId: userId,
      ip: ctx.ip, userAgent: ctx.userAgent, metadata: { source },
    }, c);
  });
  return getConsent(userId);
}

export interface DispatchInput {
  userId: string;
  template: TemplateKey;
  relatedType: 'quote' | 'invoice' | 'job' | 'subscription';
  relatedId: string;
  variables: Record<string, string>;
}

export type DispatchOutcome =
  | { status: 'sent'; messageId: string; simulated: boolean }
  | { status: 'skipped_no_consent' }
  | { status: 'failed'; error: string };

/**
 * Sends one templated message.
 *
 * Consent is checked at send time, not at queue time: a user who opts out
 * while a job sits in the queue must not receive the message.
 */
export async function dispatch(input: DispatchInput): Promise<DispatchOutcome> {
  const db = await getDb();
  const spec = TEMPLATES[input.template];
  if (!spec) return { status: 'failed', error: `Unknown template: ${input.template}` };

  const consent = await getConsent(input.userId);
  const idempotencyKey = `${input.relatedType}:${input.relatedId}:${input.template}`;

  if (!consent.optedIn || !consent.phone) {
    await db.query(
      `INSERT INTO whatsapp_messages (user_id, to_phone_masked, to_phone_hash, template_name,
                                      template_language, related_type, related_id, status, idempotency_key)
       VALUES ($1,'n/a','n/a',$2,$3,$4,$5,'skipped_no_consent',$6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [input.userId, spec.name, spec.language, input.relatedType, input.relatedId, idempotencyKey],
    );
    logger.info({ userId: input.userId, template: input.template }, 'whatsapp skipped: no consent');
    return { status: 'skipped_no_consent' };
  }

  const { rows: existing } = await db.query<{ status: string; wa_message_id: string | null }>(
    'SELECT status, wa_message_id FROM whatsapp_messages WHERE idempotency_key = $1',
    [idempotencyKey],
  );
  if (existing[0] && ['sent', 'delivered', 'read'].includes(existing[0].status)) {
    return { status: 'sent', messageId: existing[0].wa_message_id ?? 'existing', simulated: false };
  }

  const { rows: logRows } = await db.query<{ id: string }>(
    `INSERT INTO whatsapp_messages (user_id, to_phone_masked, to_phone_hash, template_name,
                                    template_language, related_type, related_id, status, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8)
     ON CONFLICT (idempotency_key) DO UPDATE SET attempts = whatsapp_messages.attempts + 1,
                                                 updated_at = now()
     RETURNING id`,
    [input.userId, maskPhone(consent.phone), hmac(consent.phone), spec.name, spec.language,
     input.relatedType, input.relatedId, idempotencyKey],
  );
  const logId = logRows[0].id;

  // Documents are delivered as a short-lived signed link, never as a public URL.
  let document: { link: string; filename: string } | undefined;
  if (spec.attachesDocument) {
    const table = input.relatedType === 'quote' ? 'quotes' : 'invoices';
    const { rows } = await db.query<{ storage_key: string; number: string }>(
      `SELECT f.storage_key, d.number FROM ${table} d
         JOIN files f ON f.id = d.pdf_file_id
        WHERE d.id = $1`,
      [input.relatedId],
    );
    if (rows[0]) {
      document = {
        link: signStorageUrl(rows[0].storage_key, 60 * 60 * 24 * 7),
        filename: `${rows[0].number}.pdf`,
      };
    }
  }

  const variables = spec.variables.map((key) => input.variables[key] ?? '');

  try {
    const result = await sendTemplate({
      toPhoneE164: consent.phone,
      templateName: spec.name,
      languageCode: spec.language,
      variables,
      document,
    });
    await db.query(
      `UPDATE whatsapp_messages SET status = 'sent', wa_message_id = $2, updated_at = now() WHERE id = $1`,
      [logId, result.messageId],
    );
    return { status: 'sent', messageId: result.messageId, simulated: result.simulated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE whatsapp_messages SET status = 'failed', error_detail = $2, updated_at = now() WHERE id = $1`,
      [logId, message.slice(0, 500)],
    );
    // The in-app notification created alongside this send is the fallback,
    // so a WhatsApp outage never loses the message entirely.
    logger.error({ err: message, userId: input.userId }, 'whatsapp delivery failed; in-app notification stands');
    if ((err as Error & { permanent?: boolean }).permanent) {
      return { status: 'failed', error: message };
    }
    throw err; // retryable: let the queue back off
  }
}

/** Applies a delivery-status callback from the WhatsApp webhook. */
export async function applyStatusUpdate(waMessageId: string, status: string, errorCode?: string) {
  const allowed = ['sent', 'delivered', 'read', 'failed'];
  if (!allowed.includes(status)) return;
  const db = await getDb();
  await db.query(
    `UPDATE whatsapp_messages SET status = $2, error_code = $3, updated_at = now()
      WHERE wa_message_id = $1`,
    [waMessageId, status, errorCode ?? null],
  );
}

/**
 * Inbound "STOP" handling. WhatsApp policy requires honouring opt-out
 * keywords received on the business number immediately.
 */
const STOP_WORDS = ['stop', 'unsubscribe', 'baja', 'cancelar', 'parar'];

export async function handleInboundMessage(fromPhoneE164: string, text: string) {
  const normalised = text.trim().toLowerCase();
  if (!STOP_WORDS.includes(normalised)) return { action: 'ignored' as const };

  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE whatsapp_phone_e164 = $1 AND whatsapp_opt_in = true',
    [fromPhoneE164],
  );
  if (!rows.length) return { action: 'ignored' as const };

  await optOut(rows[0].id, 'whatsapp_stop');
  logger.info({ userId: rows[0].id }, 'whatsapp opt-out via STOP keyword');
  return { action: 'opted_out' as const, userId: rows[0].id };
}

export function newVerifyChallenge(): string {
  return randomToken(16);
}
