import { getDb } from '../../db/index.js';
import { computeTotals, type LineInput, type TaxTreatment } from '../../lib/money.js';
import { nextNumber } from '../../lib/numbering.js';
import { conflict, notFound, badRequest } from '../../lib/errors.js';
import { enqueue } from '../../lib/queue.js';
import { writeAudit } from '../../lib/audit.js';
import { notify } from '../notifications/service.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { signStorageUrl } from '../../lib/storage.js';

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  taxTreatment?: TaxTreatment;
  taxReason?: string | null;
}

export interface CreateInvoiceInput {
  jobId?: string;
  clientId?: string;
  /** When set, the invoice is copied from the accepted quote's line items. */
  fromQuoteId?: string;
  lines?: InvoiceLineInput[];
  discountCents?: number;
  currency?: string;
  issueDate?: string;
  dueDate?: string | null;
  notes?: string | null;
}

const toLineInputs = (lines: InvoiceLineInput[]): LineInput[] =>
  lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    taxRateBp: l.taxRateBp,
    taxTreatment: l.taxTreatment ?? 'taxable',
    taxReason: l.taxReason ?? null,
  }));

export async function createInvoice(
  providerId: string,
  actorUserId: string,
  input: CreateInvoiceInput,
) {
  const db = await getDb();

  return db.tx(async (c) => {
    let lines = input.lines ?? [];
    let jobId = input.jobId ?? null;
    let clientId = input.clientId ?? null;
    let quoteId: string | null = null;
    let currency = input.currency ?? 'USD';
    let discountCents = input.discountCents ?? 0;

    if (input.fromQuoteId) {
      const { rows } = await c.query<any>(
        `SELECT q.id, q.status, q.job_id, q.currency, q.discount_cents, j.client_id
           FROM quotes q JOIN jobs j ON j.id = q.job_id
          WHERE q.id = $1 AND q.provider_id = $2`,
        [input.fromQuoteId, providerId],
      );
      const quote = rows[0];
      if (!quote) throw notFound('That quote was not found.');
      // Invoicing an un-accepted quote would bill work the customer never agreed to.
      if (quote.status !== 'accepted') {
        throw conflict('Only an accepted quote can be turned into an invoice.');
      }

      const existing = await c.query(
        `SELECT 1 FROM invoices WHERE quote_id = $1 AND status <> 'void'`,
        [input.fromQuoteId],
      );
      if (existing.rows.length) throw conflict('An invoice already exists for that quote.');

      const items = await c.query<any>(
        // The tax treatment and its reason travel with the line. Copying only
        // the rate would silently re-tax a line the customer accepted as
        // exempt, and lose the evidence for why it was not taxed.
        `SELECT description, quantity, unit_price_cents, tax_rate_bp, tax_treatment, tax_reason
           FROM quote_items WHERE quote_id = $1 ORDER BY sort_order`,
        [input.fromQuoteId],
      );
      lines = items.rows.map((i) => ({
        description: i.description,
        quantity: Number(i.quantity),
        unitPriceCents: i.unit_price_cents,
        taxRateBp: i.tax_rate_bp,
        taxTreatment: i.tax_treatment as TaxTreatment,
        taxReason: i.tax_reason,
      }));
      jobId = quote.job_id;
      clientId = quote.client_id;
      quoteId = quote.id;
      currency = quote.currency;
      discountCents = quote.discount_cents;
    } else {
      if (!lines.length) throw badRequest('Add at least one line item.');
      if (jobId) {
        const { rows } = await c.query<{ client_id: string }>(
          'SELECT client_id FROM jobs WHERE id = $1 AND provider_id = $2',
          [jobId, providerId],
        );
        if (!rows.length) throw notFound('That job was not found.');
        clientId = clientId ?? rows[0].client_id;
      }
      if (!clientId) throw badRequest('Choose a client for this invoice.');
      const owned = await c.query('SELECT 1 FROM clients WHERE id = $1 AND provider_id = $2', [
        clientId, providerId,
      ]);
      if (!owned.rows.length) throw notFound('That client was not found.');
    }

    const totals = computeTotals(toLineInputs(lines), discountCents);

    // Snapshot, not a live lookup: an issued document keeps the jurisdiction
    // it was priced under even if the provider later changes states.
    const { rows: taxRows } = await c.query<{ tax_state: string | null }>(
      'SELECT tax_state FROM providers WHERE id = $1',
      [providerId],
    );
    const jurisdiction = taxRows[0]?.tax_state ?? null;

    const number = await nextNumber(c, providerId, 'invoice');

    const { rows } = await c.query<{ id: string; created_at: string }>(
      `INSERT INTO invoices (provider_id, job_id, quote_id, client_id, number, status, currency,
                             issue_date, due_date, subtotal_cents, discount_cents, tax_cents,
                             total_cents, notes, taxable_base_cents, untaxed_base_cents,
                             tax_jurisdiction)
       VALUES ($1,$2,$3,$4,$5,'draft',$6, COALESCE($7::date, CURRENT_DATE),
               $8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, created_at`,
      [providerId, jobId, quoteId, clientId, number, currency,
       input.issueDate ?? null, input.dueDate ?? null,
       totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents,
       input.notes ?? null,
       totals.taxableBaseCents, totals.untaxedBaseCents, jurisdiction],
    );
    const invoiceId = rows[0].id;

    for (const [index, line] of totals.lines.entries()) {
      await c.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_cents,
                                    tax_rate_bp, line_total_cents, sort_order,
                                    tax_treatment, tax_reason, line_discount_cents,
                                    line_taxable_base_cents, line_tax_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [invoiceId, line.description, line.quantity, line.unitPriceCents,
         line.taxRateBp, line.lineTotalCents, index,
         line.taxTreatment, line.taxReason ?? null, line.lineDiscountCents,
         line.lineTaxableBaseCents, line.lineTaxCents],
      );
    }

    await writeAudit({
      actorUserId, actorRole: 'provider', action: 'invoice.created',
      entityType: 'invoice', entityId: invoiceId,
      metadata: { number, totalCents: totals.totalCents, fromQuoteId: quoteId },
    }, c);

    return { id: invoiceId, number, createdAt: rows[0].created_at, ...totals };
  });
}

export async function sendInvoice(providerId: string, invoiceId: string, actorUserId: string) {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT i.id, i.status, i.number, i.total_cents, i.currency, i.job_id,
            j.customer_user_id, j.title AS job_title,
            c.full_name AS client_name, p.business_name
       FROM invoices i
       LEFT JOIN jobs j ON j.id = i.job_id
       JOIN clients c ON c.id = i.client_id
       JOIN providers p ON p.id = i.provider_id
      WHERE i.id = $1 AND i.provider_id = $2`,
    [invoiceId, providerId],
  );
  const invoice = rows[0];
  if (!invoice) throw notFound('That invoice was not found.');
  if (invoice.status !== 'draft') throw conflict('That invoice has already been sent.');

  const shareToken = randomToken(32);
  await db.query(
    `UPDATE invoices SET status = 'sent', sent_at = now(), share_token_hash = $2, updated_at = now()
      WHERE id = $1`,
    [invoiceId, sha256(shareToken)],
  );

  await enqueue('pdf.generate', { kind: 'invoice', id: invoiceId }, { dedupeKey: `pdf:invoice:${invoiceId}` });

  if (invoice.customer_user_id) {
    await notify(invoice.customer_user_id, {
      type: 'invoice.received',
      title: `Invoice from ${invoice.business_name}`,
      body: `${invoice.job_title ?? 'Service'} — ${invoice.number}`,
      data: { invoiceId, totalCents: invoice.total_cents, currency: invoice.currency },
      whatsapp: {
        template: 'invoice_ready',
        relatedType: 'invoice',
        relatedId: invoiceId,
        variables: {
          customer_name: invoice.client_name,
          business_name: invoice.business_name,
          invoice_number: invoice.number,
        },
      },
    });
  }

  await writeAudit({
    actorUserId, actorRole: 'provider', action: 'invoice.sent',
    entityType: 'invoice', entityId: invoiceId,
    metadata: { number: invoice.number, totalCents: invoice.total_cents },
  });

  return { id: invoiceId, status: 'sent', shareToken };
}

export async function getInvoice(invoiceId: string, viewer: { providerId?: string; userId?: string }) {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT i.*, j.title AS job_title, j.customer_user_id,
            c.full_name AS client_name, c.email AS client_email, c.phone_e164 AS client_phone,
            c.address_line AS client_address, c.city AS client_city,
            p.business_name, p.tagline, p.city AS provider_city, p.phone_e164 AS provider_phone,
            p.address_line AS provider_address,
            f.storage_key AS pdf_key
       FROM invoices i
       LEFT JOIN jobs j ON j.id = i.job_id
       JOIN clients c ON c.id = i.client_id
       JOIN providers p ON p.id = i.provider_id
       LEFT JOIN files f ON f.id = i.pdf_file_id
      WHERE i.id = $1`,
    [invoiceId],
  );
  const inv = rows[0];
  if (!inv) throw notFound('That invoice was not found.');

  const isOwner = viewer.providerId && inv.provider_id === viewer.providerId;
  const isCustomer = viewer.userId && inv.customer_user_id === viewer.userId;
  if (!isOwner && !isCustomer) throw notFound('That invoice was not found.');
  if (!isOwner && inv.status === 'draft') throw notFound('That invoice was not found.');

  const [items, payments] = await Promise.all([
    db.query<any>(
      `SELECT description, quantity, unit_price_cents, tax_rate_bp, line_total_cents,
              tax_treatment, tax_reason, line_discount_cents, line_taxable_base_cents,
              line_tax_cents
         FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
      [invoiceId],
    ),
    db.query<any>(
      `SELECT amount_cents, status, method, paid_at, created_at
         FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC`,
      [invoiceId],
    ),
  ]);

  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    currency: inv.currency,
    issueDate: inv.issue_date,
    dueDate: inv.due_date,
    subtotalCents: inv.subtotal_cents,
    discountCents: inv.discount_cents,
    taxCents: inv.tax_cents,
    totalCents: inv.total_cents,
    amountPaidCents: inv.amount_paid_cents,
    balanceCents: inv.total_cents - inv.amount_paid_cents,
    notes: inv.notes,
    sentAt: inv.sent_at,
    paidAt: inv.paid_at,
    createdAt: inv.created_at,
    pdfUrl: inv.pdf_key ? signStorageUrl(inv.pdf_key) : null,
    pdfSha256: inv.pdf_sha256,
    job: inv.job_id ? { id: inv.job_id, title: inv.job_title } : null,
    provider: {
      businessName: inv.business_name,
      tagline: inv.tagline,
      city: inv.provider_city,
      phone: inv.provider_phone,
    },
    client: {
      fullName: inv.client_name,
      email: isOwner ? inv.client_email : undefined,
      phone: isOwner ? inv.client_phone : undefined,
      city: inv.client_city,
    },
    taxableBaseCents: inv.taxable_base_cents,
    untaxedBaseCents: inv.untaxed_base_cents,
    taxJurisdiction: inv.tax_jurisdiction,
    lines: items.rows.map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unitPriceCents: i.unit_price_cents,
      taxRateBp: i.tax_rate_bp,
      lineTotalCents: i.line_total_cents,
      taxTreatment: i.tax_treatment,
      // Why no tax was charged travels to the customer's copy and the PDF:
      // an unexplained untaxed line is what an audit asks about.
      taxReason: i.tax_reason,
      lineDiscountCents: i.line_discount_cents,
      lineTaxableBaseCents: i.line_taxable_base_cents,
      lineTaxCents: i.line_tax_cents,
    })),
    payments: payments.rows.map((p) => ({
      amountCents: p.amount_cents,
      status: p.status,
      method: p.method,
      paidAt: p.paid_at,
      createdAt: p.created_at,
    })),
  };
}

/** Records a payment against an invoice and rolls the status forward. */
export async function recordPayment(
  providerId: string,
  invoiceId: string,
  actorUserId: string,
  input: { amountCents: number; method?: string; reference?: string },
) {
  const db = await getDb();

  return db.tx(async (c) => {
    const { rows } = await c.query<any>(
      `SELECT id, status, total_cents, amount_paid_cents, number, currency
         FROM invoices WHERE id = $1 AND provider_id = $2`,
      [invoiceId, providerId],
    );
    const inv = rows[0];
    if (!inv) throw notFound('That invoice was not found.');
    if (inv.status === 'void') throw conflict('That invoice has been voided.');
    if (inv.status === 'draft') throw conflict('Send the invoice before recording a payment.');

    const newPaid = inv.amount_paid_cents + input.amountCents;
    if (newPaid > inv.total_cents) {
      throw conflict('That payment is more than the outstanding balance.', {
        balanceCents: inv.total_cents - inv.amount_paid_cents,
      });
    }

    const status = newPaid >= inv.total_cents ? 'paid' : 'partially_paid';
    await c.query(
      `UPDATE invoices SET amount_paid_cents = $2, status = $3,
              paid_at = CASE WHEN $3 = 'paid' THEN now() ELSE paid_at END,
              updated_at = now()
        WHERE id = $1`,
      [invoiceId, newPaid, status],
    );
    await c.query(
      `INSERT INTO payments (provider_id, invoice_id, kind, amount_cents, currency, status,
                             method, external_ref, paid_at)
       VALUES ($1,$2,'invoice',$3,$4,'succeeded',$5,$6, now())`,
      [providerId, invoiceId, input.amountCents, inv.currency, input.method ?? 'manual',
       input.reference ?? null],
    );

    await writeAudit({
      actorUserId, actorRole: 'provider', action: 'invoice.payment_recorded',
      entityType: 'invoice', entityId: invoiceId,
      metadata: { number: inv.number, amountCents: input.amountCents, status },
    }, c);

    return {
      id: invoiceId,
      status,
      amountPaidCents: newPaid,
      balanceCents: inv.total_cents - newPaid,
    };
  });
}
