import { getDb } from '../../db/index.js';
import { computeTotals, type LineInput } from '../../lib/money.js';
import { nextNumber } from '../../lib/numbering.js';
import { conflict, notFound, forbidden } from '../../lib/errors.js';
import { enqueue } from '../../lib/queue.js';
import { writeAudit } from '../../lib/audit.js';
import { notify } from '../notifications/service.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { signStorageUrl } from '../../lib/storage.js';

export interface QuoteLineInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
}

export interface CreateQuoteInput {
  jobId: string;
  lines: QuoteLineInput[];
  discountCents?: number;
  currency?: string;
  validUntil?: string | null;
  notes?: string | null;
  terms?: string | null;
}

const toLineInputs = (lines: QuoteLineInput[]): LineInput[] =>
  lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    taxRateBp: l.taxRateBp,
  }));

/**
 * Creates a draft quote. Totals are always recomputed server-side from the
 * line items — a client-supplied total is never trusted, which is what stops
 * a tampered payload from producing a $1 quote for $1,000 of work.
 */
export async function createQuote(
  providerId: string,
  actorUserId: string,
  input: CreateQuoteInput,
) {
  const db = await getDb();
  const totals = computeTotals(toLineInputs(input.lines), input.discountCents ?? 0);

  return db.tx(async (c) => {
    const { rows: jobRows } = await c.query<{ id: string; status: string }>(
      'SELECT id, status FROM jobs WHERE id = $1 AND provider_id = $2',
      [input.jobId, providerId],
    );
    if (!jobRows.length) throw notFound('That job was not found.');

    const number = await nextNumber(c, providerId, 'quote');
    const { rows } = await c.query<{ id: string; created_at: string }>(
      `INSERT INTO quotes (provider_id, job_id, number, status, currency, subtotal_cents,
                           discount_cents, tax_cents, total_cents, valid_until, notes, terms)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, created_at`,
      [providerId, input.jobId, number, input.currency ?? 'USD',
       totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents,
       input.validUntil ?? null, input.notes ?? null, input.terms ?? null],
    );
    const quoteId = rows[0].id;

    for (const [index, line] of totals.lines.entries()) {
      await c.query(
        `INSERT INTO quote_items (quote_id, description, quantity, unit_price_cents,
                                  tax_rate_bp, line_total_cents, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [quoteId, line.description, line.quantity, line.unitPriceCents,
         line.taxRateBp, line.lineTotalCents, index],
      );
    }

    await writeAudit({
      actorUserId, actorRole: 'provider', action: 'quote.created',
      entityType: 'quote', entityId: quoteId,
      metadata: { number, totalCents: totals.totalCents, jobId: input.jobId },
    }, c);

    return { id: quoteId, number, createdAt: rows[0].created_at, ...totals };
  });
}

export async function updateQuote(
  providerId: string,
  quoteId: string,
  actorUserId: string,
  input: Partial<CreateQuoteInput>,
) {
  const db = await getDb();
  return db.tx(async (c) => {
    const { rows } = await c.query<any>(
      'SELECT id, status, currency FROM quotes WHERE id = $1 AND provider_id = $2',
      [quoteId, providerId],
    );
    const quote = rows[0];
    if (!quote) throw notFound('That quote was not found.');
    // Once a quote is out with the customer its figures are frozen.
    if (quote.status !== 'draft') {
      throw conflict('Only draft quotes can be edited. Create a new quote instead.');
    }

    if (input.lines) {
      const totals = computeTotals(toLineInputs(input.lines), input.discountCents ?? 0);
      await c.query('DELETE FROM quote_items WHERE quote_id = $1', [quoteId]);
      for (const [index, line] of totals.lines.entries()) {
        await c.query(
          `INSERT INTO quote_items (quote_id, description, quantity, unit_price_cents,
                                    tax_rate_bp, line_total_cents, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [quoteId, line.description, line.quantity, line.unitPriceCents,
           line.taxRateBp, line.lineTotalCents, index],
        );
      }
      await c.query(
        `UPDATE quotes SET subtotal_cents = $2, discount_cents = $3, tax_cents = $4,
                total_cents = $5, updated_at = now() WHERE id = $1`,
        [quoteId, totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents],
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [quoteId];
    for (const [key, column] of Object.entries({
      validUntil: 'valid_until', notes: 'notes', terms: 'terms', currency: 'currency',
    })) {
      if (!(key in input)) continue;
      params.push((input as Record<string, unknown>)[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length) {
      await c.query(`UPDATE quotes SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    }

    await writeAudit({
      actorUserId, actorRole: 'provider', action: 'quote.updated',
      entityType: 'quote', entityId: quoteId,
    }, c);

    return { id: quoteId };
  });
}

/**
 * Sends a quote: freezes it, mints a share token, queues PDF rendering and
 * (consent permitting) WhatsApp delivery, and notifies the customer in-app.
 */
export async function sendQuote(providerId: string, quoteId: string, actorUserId: string) {
  const db = await getDb();

  const { rows } = await db.query<any>(
    `SELECT q.id, q.status, q.number, q.total_cents, q.currency, q.job_id,
            j.customer_user_id, j.title AS job_title, j.status AS job_status,
            c.full_name AS client_name,
            p.business_name
       FROM quotes q
       JOIN jobs j ON j.id = q.job_id
       JOIN clients c ON c.id = j.client_id
       JOIN providers p ON p.id = q.provider_id
      WHERE q.id = $1 AND q.provider_id = $2`,
    [quoteId, providerId],
  );
  const quote = rows[0];
  if (!quote) throw notFound('That quote was not found.');
  if (quote.status !== 'draft') throw conflict('That quote has already been sent.');

  const items = await db.query<{ count: string }>(
    'SELECT count(*)::text FROM quote_items WHERE quote_id = $1',
    [quoteId],
  );
  if (Number(items.rows[0].count) === 0) {
    throw conflict('Add at least one line item before sending.');
  }

  // Opaque, single-purpose link token. Only its hash is stored, so a database
  // read does not yield working links to customer documents.
  const shareToken = randomToken(32);

  await db.tx(async (c) => {
    await c.query(
      `UPDATE quotes SET status = 'sent', sent_at = now(), share_token_hash = $2, updated_at = now()
        WHERE id = $1`,
      [quoteId, sha256(shareToken)],
    );
    // Advance the pipeline, but never regress a job that has moved on.
    if (['new_lead', 'contacted'].includes(quote.job_status)) {
      await c.query(`UPDATE jobs SET status = 'quoted', updated_at = now() WHERE id = $1`, [quote.job_id]);
      await c.query(
        `INSERT INTO job_status_events (job_id, from_status, to_status, actor_user_id, note)
         VALUES ($1,$2,'quoted',$3,'Quote sent')`,
        [quote.job_id, quote.job_status, actorUserId],
      );
    }
    await writeAudit({
      actorUserId, actorRole: 'provider', action: 'quote.sent',
      entityType: 'quote', entityId: quoteId,
      metadata: { number: quote.number, totalCents: quote.total_cents },
    }, c);
  });

  await enqueue('pdf.generate', { kind: 'quote', id: quoteId }, { dedupeKey: `pdf:quote:${quoteId}` });

  if (quote.customer_user_id) {
    await notify(quote.customer_user_id, {
      type: 'quote.received',
      title: `New quote from ${quote.business_name}`,
      body: `${quote.job_title} — ${quote.number}`,
      data: { quoteId, jobId: quote.job_id, totalCents: quote.total_cents, currency: quote.currency },
      whatsapp: {
        template: 'quote_ready',
        relatedType: 'quote',
        relatedId: quoteId,
        variables: {
          customer_name: quote.client_name,
          business_name: quote.business_name,
          quote_number: quote.number,
        },
      },
    });
  }

  return { id: quoteId, status: 'sent', shareToken };
}

export async function getQuote(quoteId: string, viewer: { providerId?: string; userId?: string }) {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT q.*, j.title AS job_title, j.customer_user_id, j.id AS job_id,
            c.full_name AS client_name, c.email AS client_email, c.phone_e164 AS client_phone,
            c.address_line AS client_address, c.city AS client_city,
            p.business_name, p.tagline, p.city AS provider_city, p.phone_e164 AS provider_phone,
            p.address_line AS provider_address,
            f.storage_key AS pdf_key
       FROM quotes q
       JOIN jobs j ON j.id = q.job_id
       JOIN clients c ON c.id = j.client_id
       JOIN providers p ON p.id = q.provider_id
       LEFT JOIN files f ON f.id = q.pdf_file_id
      WHERE q.id = $1`,
    [quoteId],
  );
  const q = rows[0];
  if (!q) throw notFound('That quote was not found.');

  // Authorisation is by ownership, and a miss reads as 404 so that quote ids
  // cannot be probed for existence.
  const isOwner = viewer.providerId && q.provider_id === viewer.providerId;
  const isCustomer = viewer.userId && q.customer_user_id === viewer.userId;
  if (!isOwner && !isCustomer) throw notFound('That quote was not found.');
  // A draft is the provider's working copy and is not visible to the customer.
  if (!isOwner && q.status === 'draft') throw notFound('That quote was not found.');

  const items = await db.query<any>(
    `SELECT description, quantity, unit_price_cents, tax_rate_bp, line_total_cents
       FROM quote_items WHERE quote_id = $1 ORDER BY sort_order`,
    [quoteId],
  );

  return {
    id: q.id,
    number: q.number,
    status: q.status,
    currency: q.currency,
    subtotalCents: q.subtotal_cents,
    discountCents: q.discount_cents,
    taxCents: q.tax_cents,
    totalCents: q.total_cents,
    validUntil: q.valid_until,
    notes: q.notes,
    terms: q.terms,
    sentAt: q.sent_at,
    acceptedAt: q.accepted_at,
    declinedAt: q.declined_at,
    declineReason: q.decline_reason,
    createdAt: q.created_at,
    pdfUrl: q.pdf_key ? signStorageUrl(q.pdf_key) : null,
    pdfSha256: q.pdf_sha256,
    job: { id: q.job_id, title: q.job_title },
    provider: {
      businessName: q.business_name,
      tagline: q.tagline,
      city: q.provider_city,
      phone: q.provider_phone,
    },
    client: {
      fullName: q.client_name,
      email: isOwner ? q.client_email : undefined,
      phone: isOwner ? q.client_phone : undefined,
      city: q.client_city,
    },
    lines: items.rows.map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unitPriceCents: i.unit_price_cents,
      taxRateBp: i.tax_rate_bp,
      lineTotalCents: i.line_total_cents,
    })),
  };
}

/** Customer decision. Only the customer named on the job may respond. */
export async function respondToQuote(
  quoteId: string,
  customerUserId: string,
  decision: 'accept' | 'decline',
  reason?: string,
) {
  const db = await getDb();

  return db.tx(async (c) => {
    const { rows } = await c.query<any>(
      `SELECT q.id, q.status, q.number, q.valid_until, q.provider_id, q.job_id, q.total_cents,
              q.currency, j.customer_user_id, j.status AS job_status, j.title AS job_title,
              p.user_id AS provider_user_id
         FROM quotes q
         JOIN jobs j ON j.id = q.job_id
         JOIN providers p ON p.id = q.provider_id
        WHERE q.id = $1`,
      [quoteId],
    );
    const quote = rows[0];
    if (!quote) throw notFound('That quote was not found.');
    if (quote.customer_user_id !== customerUserId) throw notFound('That quote was not found.');
    if (quote.status === 'accepted' || quote.status === 'declined') {
      throw conflict('You have already responded to this quote.');
    }
    if (quote.status !== 'sent') throw conflict('That quote is not open for a response.');
    if (quote.valid_until && new Date(quote.valid_until).getTime() < Date.now() - 86_400_000) {
      await c.query(`UPDATE quotes SET status = 'expired' WHERE id = $1`, [quoteId]);
      throw conflict('That quote has expired. Ask the provider for an updated one.');
    }

    if (decision === 'accept') {
      await c.query(
        `UPDATE quotes SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE id = $1`,
        [quoteId],
      );
      await c.query(
        `UPDATE jobs SET status = 'approved', updated_at = now() WHERE id = $1`,
        [quote.job_id],
      );
      await c.query(
        `INSERT INTO job_status_events (job_id, from_status, to_status, actor_user_id, note)
         VALUES ($1,$2,'approved',$3,'Quote accepted by customer')`,
        [quote.job_id, quote.job_status, customerUserId],
      );
      // Any other open quote on the same job is superseded.
      await c.query(
        `UPDATE quotes SET status = 'cancelled', updated_at = now()
          WHERE job_id = $1 AND id <> $2 AND status = 'sent'`,
        [quote.job_id, quoteId],
      );
    } else {
      await c.query(
        `UPDATE quotes SET status = 'declined', declined_at = now(), decline_reason = $2,
                updated_at = now() WHERE id = $1`,
        [quoteId, reason ?? null],
      );
    }

    await notify(quote.provider_user_id, {
      type: decision === 'accept' ? 'quote.accepted' : 'quote.declined',
      title: decision === 'accept' ? 'Quote accepted' : 'Quote declined',
      body: `${quote.job_title} — ${quote.number}`,
      data: { quoteId, jobId: quote.job_id },
    }, c);

    await writeAudit({
      actorUserId: customerUserId, actorRole: 'customer',
      action: decision === 'accept' ? 'quote.accepted' : 'quote.declined',
      entityType: 'quote', entityId: quoteId,
      metadata: { number: quote.number, totalCents: quote.total_cents },
    }, c);

    return { id: quoteId, status: decision === 'accept' ? 'accepted' : 'declined' };
  });
}
