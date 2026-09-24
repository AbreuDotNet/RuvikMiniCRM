import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { renderDocument, type DocumentLine } from '../lib/pdf.js';
import { storeFile } from '../modules/files/service.js';
import { dispatch, type TemplateKey } from '../modules/whatsapp/service.js';
import { notify } from '../modules/notifications/service.js';
import { getStorage } from '../lib/storage.js';
import { sendPush } from '../lib/push.js';
import { env } from '../config/env.js';
import type { QueueName } from '../lib/queue.js';
import { GRACE_DAYS, scheduleGraceExpiry } from '../modules/billing/service.js';
import { OVERDUE_CANDIDATE_STATUSES, sqlIn } from '../lib/invoiceStatus.js';

export type JobHandler = (payload: Record<string, any>) => Promise<void>;

/* ---------------------------- PDF generation ------------------------------ */

async function generatePdf(payload: Record<string, any>): Promise<void> {
  const kind = payload.kind as 'quote' | 'invoice';
  const id = String(payload.id);
  const db = await getDb();
  const table = kind === 'quote' ? 'quotes' : 'invoices';
  const itemsTable = kind === 'quote' ? 'quote_items' : 'invoice_items';
  const fkColumn = kind === 'quote' ? 'quote_id' : 'invoice_id';

  const { rows } = await db.query<any>(
    `SELECT d.*, p.business_name, p.tagline, p.city AS provider_city, p.address_line AS provider_address,
            p.phone_e164 AS provider_phone, p.user_id AS provider_user_id,
            u.email AS provider_email,
            c.full_name AS client_name, c.email AS client_email, c.phone_e164 AS client_phone,
            c.address_line AS client_address, c.city AS client_city
       FROM ${table} d
       JOIN providers p ON p.id = d.provider_id
       JOIN users u ON u.id = p.user_id
       ${kind === 'quote'
         ? 'JOIN jobs j ON j.id = d.job_id JOIN clients c ON c.id = j.client_id'
         : 'JOIN clients c ON c.id = d.client_id'}
      WHERE d.id = $1`,
    [id],
  );
  const doc = rows[0];
  if (!doc) {
    logger.warn({ kind, id }, 'pdf generation skipped: document not found');
    return;
  }

  const items = await db.query<any>(
    `SELECT description, quantity, unit_price_cents, tax_rate_bp, line_total_cents,
            tax_treatment, tax_reason, line_kind, line_tax_cents, tax_exemption_certificate
       FROM ${itemsTable} WHERE ${fkColumn} = $1 ORDER BY sort_order`,
    [id],
  );

  const lines: DocumentLine[] = items.rows.map((i) => ({
    description: i.description,
    quantity: Number(i.quantity),
    unitPriceCents: i.unit_price_cents,
    taxRateBp: i.tax_rate_bp,
    lineTotalCents: i.line_total_cents,
    taxTreatment: i.tax_treatment,
    taxReason: i.tax_reason,
    // The tax actually charged on the line, so the document shows a figure
    // rather than a rate the reader has to apply themselves.
    lineTaxCents: i.line_tax_cents,
    lineKind: i.line_kind,
    taxExemptionCertificate: i.tax_exemption_certificate,
  }));

  const asDate = (v: unknown) =>
    v ? new Date(v as string).toISOString().slice(0, 10) : null;

  const rendered = await renderDocument({
    kind,
    number: doc.number,
    currency: doc.currency,
    status: doc.status,
    issueDate: asDate(doc.issue_date ?? doc.created_at) ?? new Date().toISOString().slice(0, 10),
    dueDate: kind === 'invoice' ? asDate(doc.due_date) : null,
    validUntil: kind === 'quote' ? asDate(doc.valid_until) : null,
    from: {
      name: doc.business_name,
      tagline: doc.tagline,
      addressLine: doc.provider_address,
      city: doc.provider_city,
      phone: doc.provider_phone,
      email: doc.provider_email,
    },
    to: {
      name: doc.client_name,
      email: doc.client_email,
      phone: doc.client_phone,
      addressLine: doc.client_address,
      city: doc.client_city,
    },
    lines,
    subtotalCents: doc.subtotal_cents,
    discountCents: doc.discount_cents,
    taxCents: doc.tax_cents,
    totalCents: doc.total_cents,
    taxableBaseCents: doc.taxable_base_cents,
    untaxedBaseCents: doc.untaxed_base_cents,
    taxJurisdiction: doc.tax_jurisdiction,
    // Where and when the work happened. Only invoices carry it: a quote is
    // priced before the work exists.
    serviceAddress: kind === 'invoice' && doc.service_address_line
      ? {
          name: [doc.service_region, doc.service_postal_code].filter(Boolean).join(' '),
          addressLine: doc.service_address_line,
          city: doc.service_city,
        }
      : null,
    serviceDate: kind === 'invoice' ? asDate(doc.service_date) : null,
    contractType: doc.contract_type,
    amountPaidCents: kind === 'invoice' ? doc.amount_paid_cents : undefined,
    notes: doc.notes,
    terms: kind === 'quote' ? doc.terms : null,
    verificationUrl: `${env.WEB_BASE_URL}/verify/${kind}/${id}`,
  });

  // Replacing a previously rendered PDF leaves no orphan in object storage.
  if (doc.pdf_file_id) {
    const old = await db.query<{ storage_key: string }>(
      'SELECT storage_key FROM files WHERE id = $1',
      [doc.pdf_file_id],
    );
    if (old.rows[0]) await getStorage().delete(old.rows[0].storage_key).catch(() => undefined);
  }

  const stored = await storeFile({
    buffer: rendered.buffer,
    declaredMime: 'application/pdf',
    originalName: `${doc.number}.pdf`,
    ownerUserId: doc.provider_user_id,
    providerId: doc.provider_id,
    kind: kind === 'quote' ? 'quote_pdf' : 'invoice_pdf',
    trusted: true, // generated by this service, not user-supplied
  });

  // The digest is stored so a forwarded PDF can be checked against the record.
  await db.query(
    `UPDATE ${table} SET pdf_file_id = $2, pdf_sha256 = $3, updated_at = now() WHERE id = $1`,
    [id, stored.id, rendered.sha256],
  );

  logger.info({ kind, id, bytes: rendered.buffer.length }, 'pdf generated');
}

/* --------------------------- WhatsApp delivery ---------------------------- */

async function sendWhatsapp(payload: Record<string, any>): Promise<void> {
  const outcome = await dispatch({
    userId: String(payload.userId),
    template: String(payload.template) as TemplateKey,
    relatedType: payload.relatedType,
    relatedId: String(payload.relatedId),
    variables: (payload.variables ?? {}) as Record<string, string>,
  });

  if (outcome.status === 'failed') {
    // Permanent failure: the in-app notification already delivered the news.
    logger.warn({ userId: payload.userId, error: outcome.error }, 'whatsapp permanently failed');
  }
}

/* --------------------------- push notifications --------------------------- */

/**
 * Delivers one notification to every handset the recipient has registered.
 *
 * Three things happen here that are easy to leave out and expensive to leave
 * out:
 *
 *   * **A suspended or deleted account is not notified.** The token outlives
 *     the suspension, and `authenticate` only stops them *using* the app — it
 *     cannot stop a push that was already on its way. Checked here because
 *     this is the last point that knows.
 *   * **The badge carries the real unread count**, read at send time rather
 *     than passed in by the caller. A count computed when the notification was
 *     created is already stale by the time it reaches the device.
 *   * **Dead tokens are pruned.** Expo reports an uninstalled app as
 *     `DeviceNotRegistered`, and their guidance is to stop sending to it;
 *     keeping it would cost a slot in every future batch for ever.
 */
async function sendPushNotification(payload: Record<string, any>): Promise<void> {
  const db = await getDb();
  const userId = String(payload.userId);

  const { rows: recipient } = await db.query<{ status: string; deleted_at: string | null }>(
    'SELECT status, deleted_at FROM users WHERE id = $1',
    [userId],
  );
  if (!recipient[0] || recipient[0].deleted_at || recipient[0].status !== 'active') {
    logger.info({ userId }, 'push skipped: recipient is not active');
    return;
  }

  const { rows: devices } = await db.query<{ token: string }>(
    'SELECT token FROM device_tokens WHERE user_id = $1',
    [userId],
  );
  // No devices is the common case for web-only users, and is not a failure.
  if (!devices.length) return;

  const { rows: unread } = await db.query<{ count: string }>(
    'SELECT count(*)::text FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  const badge = Number(unread[0]?.count ?? 0);

  const outcomes = await sendPush(
    devices.map((d) => ({
      token: d.token,
      title: String(payload.title),
      body: String(payload.body),
      data: (payload.data ?? {}) as Record<string, unknown>,
      badge,
    })),
  );

  const dead = outcomes
    .filter((o) => o.status === 'unregistered' || o.status === 'error')
    .map((o) => o.token);

  if (dead.length) {
    // An 'unregistered' token is gone for good and is removed outright. A soft
    // error only counts against the token, and the row is dropped once it has
    // failed enough times to be worth nothing.
    const unregistered = outcomes.filter((o) => o.status === 'unregistered').map((o) => o.token);
    if (unregistered.length) {
      await db.query('DELETE FROM device_tokens WHERE token = ANY($1::text[])', [unregistered]);
    }
    const soft = outcomes.filter((o) => o.status === 'error').map((o) => o.token);
    if (soft.length) {
      await db.query(
        `UPDATE device_tokens SET failure_count = failure_count + 1 WHERE token = ANY($1::text[])`,
        [soft],
      );
      await db.query('DELETE FROM device_tokens WHERE failure_count >= 10');
    }
    logger.warn({ userId, dead: dead.length }, 'push tokens failed');
  }

  const delivered = outcomes.filter((o) => o.status === 'ok').length;
  if (delivered) {
    await db.query('UPDATE device_tokens SET last_seen_at = now() WHERE user_id = $1', [userId]);
  }
  logger.info({ userId, delivered, failed: dead.length }, 'push dispatched');
}

/* ------------------------------ email (stub) ------------------------------ */

/**
 * Email delivery is behind the same queue contract as WhatsApp. Wiring a
 * transactional provider means replacing this body only.
 */
async function sendEmail(payload: Record<string, any>): Promise<void> {
  logger.info({ template: payload.template, userId: payload.userId }, 'email queued (no transport configured)');
}

/* ------------------------------- billing ---------------------------------- */

async function renewSubscription(payload: Record<string, any>): Promise<void> {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT s.id, s.status, s.cancel_at_period_end, s.current_period_end, p.user_id, sp.name
       FROM subscriptions s
       JOIN providers p ON p.id = s.provider_id
       JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.id = $1`,
    [String(payload.subscriptionId)],
  );
  const sub = rows[0];
  if (!sub || sub.status !== 'active') return;

  if (sub.cancel_at_period_end) {
    await db.query(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`,
      [sub.id],
    );
    await notify(sub.user_id, {
      type: 'subscription.ended',
      title: 'Subscription ended',
      body: `Your ${sub.name} plan has ended as requested.`,
      data: { subscriptionId: sub.id },
    });
    return;
  }

  // A real gateway charge would go here; until it confirms, the subscription
  // moves to past_due rather than silently extending.
  await db.query(
    `UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE id = $1`,
    [sub.id],
  );
  // past_due used to be a terminal state in practice: nothing ever moved a
  // subscription out of it, so a provider who stopped paying kept their
  // listing for ever. This is the clock that ends it.
  await scheduleGraceExpiry(db, sub.id);

  await notify(sub.user_id, {
    type: 'subscription.renewal_due',
    title: 'Subscription renewal due',
    body: `Your ${sub.name} plan needs a renewal payment. You stay listed in search `
      + `for ${GRACE_DAYS} more days.`,
    data: { subscriptionId: sub.id },
  });
}

/**
 * Ends the grace window opened by a failed or missed renewal.
 *
 * Idempotent on purpose: the job is booked when the charge fails and runs a
 * week later, by which time the provider may well have paid. Anything that is
 * no longer `past_due` is left exactly as it is.
 */
async function expireGrace(payload: Record<string, any>): Promise<void> {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT s.id, s.status, p.user_id, sp.name
       FROM subscriptions s
       JOIN providers p ON p.id = s.provider_id
       JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.id = $1`,
    [String(payload.subscriptionId)],
  );
  const sub = rows[0];
  if (!sub || sub.status !== 'past_due') return;

  await db.query(
    `UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE id = $1`,
    [sub.id],
  );

  // Visibility is derived from this status in discovery, so nothing needs to
  // touch the provider's own is_published flag — which stays theirs, and
  // means paying again restores the listing with no state to put back.
  await notify(sub.user_id, {
    type: 'subscription.expired',
    title: 'Your listings are no longer visible',
    body: `Your ${sub.name} plan expired after ${GRACE_DAYS} days without payment. `
      + 'Choose a plan to appear in search again.',
    data: { subscriptionId: sub.id },
  });

  logger.info({ subscriptionId: sub.id }, 'subscription grace expired');
}

/* --------------------------- overdue invoices ----------------------------- */

async function flagOverdueInvoices(): Promise<void> {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `UPDATE invoices SET status = 'overdue', updated_at = now()
      WHERE status IN ${sqlIn(OVERDUE_CANDIDATE_STATUSES)}
        AND due_date IS NOT NULL AND due_date < CURRENT_DATE
      RETURNING id, number, provider_id, job_id, total_cents, amount_paid_cents`,
  );
  for (const inv of rows) {
    const owner = await db.query<{ user_id: string }>(
      'SELECT user_id FROM providers WHERE id = $1',
      [inv.provider_id],
    );
    if (owner.rows[0]) {
      await notify(owner.rows[0].user_id, {
        type: 'invoice.overdue',
        title: 'Invoice overdue',
        body: `${inv.number} is past its due date.`,
        data: { invoiceId: inv.id },
      });
    }
  }
  if (rows.length) logger.info({ count: rows.length }, 'invoices flagged overdue');
}

/* ------------------------------ file scanning ----------------------------- */

/**
 * Quarantine release. A real deployment points this at ClamAV or a cloud
 * scanning API; the contract (pending -> clean/infected) does not change.
 */
async function scanFile(payload: Record<string, any>): Promise<void> {
  const db = await getDb();
  const fileId = String(payload.fileId);
  const { rows } = await db.query<{ storage_key: string; size_bytes: string }>(
    'SELECT storage_key, size_bytes FROM files WHERE id = $1',
    [fileId],
  );
  if (!rows[0]) return;

  const buffer = await getStorage().get(rows[0].storage_key);

  // Baseline heuristics until a scanner is wired in: reject anything carrying
  // markup or script, which is how an "image" turns into stored XSS.
  const head = buffer.subarray(0, 2048).toString('latin1').toLowerCase();
  const suspicious = ['<script', '<?php', '<!doctype html', '<svg', '%!ps'];
  const infected = suspicious.some((needle) => head.includes(needle));

  await db.query(
    `UPDATE files SET scan_status = $2, scan_note = $3 WHERE id = $1`,
    [fileId, infected ? 'infected' : 'clean', infected ? 'Rejected: embedded markup or script' : null],
  );

  if (infected) {
    await getStorage().delete(rows[0].storage_key).catch(() => undefined);
    logger.warn({ fileId }, 'uploaded file rejected by scanner');
  }
}

export const HANDLERS: Record<QueueName, JobHandler> = {
  'pdf.generate': generatePdf,
  'whatsapp.send': sendWhatsapp,
  'email.send': sendEmail,
  'notification.push': sendPushNotification,
  'billing.renew': renewSubscription,
  'billing.grace_expired': expireGrace,
  'invoice.overdue': flagOverdueInvoices,
  'file.scan': scanFile,
};
