import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { limiters } from '../../middleware/rateLimit.js';
import { validate, uuidSchema } from '../../middleware/validate.js';
import { notFound } from '../../lib/errors.js';

/**
 * Document verification, for whoever is holding the paper.
 *
 * Every quote and invoice PDF has carried "Document digest verifiable at
 * <WEB_BASE_URL>/verify/<kind>/<id>" in its footer since PDF rendering was
 * built, and that route did not exist. Every document Ruvik has ever issued
 * pointed at a 404 — which is worse than printing nothing, because it invites
 * the one check a recipient might make and then fails it.
 *
 * What this answers is deliberately narrow: does a document with this id
 * exist, who issued it, what does it say it is worth, and what is the digest
 * of the file we rendered. That is enough for a recipient to confirm the sheet
 * in their hand was not altered, and no more.
 *
 * ## Why an unauthenticated id is not a leak here
 *
 * The id is a v4 UUID printed on the document itself, so reaching this page at
 * all means already holding the document — and the document contains strictly
 * more than the response does. Possession is the capability, which is the same
 * bargain the storage layer's signed URLs make.
 *
 * What is deliberately absent is everything the holder would *not* already
 * have: no line items, no notes, no client name, no contact details, no job.
 * A recipient verifying an invoice learns nothing about the issuer's other
 * customers, and an id guessed at random returns the same 404 as one that was
 * never issued.
 *
 * Drafts are invisible. A draft has never been sent to anybody, so nobody can
 * legitimately be holding one, and confirming that an id names a draft would
 * disclose the existence of unsent work.
 */
export const verifyRouter = Router();

const paramsSchema = z.object({
  kind: z.enum(['quote', 'invoice']),
  id: uuidSchema,
});

verifyRouter.get(
  '/:kind/:id',
  // Public and unauthenticated, so it shares the discovery budget rather than
  // offering an unmetered way to probe ids.
  limiters.search,
  validate(paramsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { kind, id } = req.params as z.infer<typeof paramsSchema>;
    const db = await getDb();

    const table = kind === 'quote' ? 'quotes' : 'invoices';
    const issuedAt = kind === 'quote' ? 'd.created_at::date' : 'd.issue_date';

    const { rows } = await db.query<any>(
      `SELECT d.number, d.status, d.currency, d.total_cents, d.pdf_sha256,
              ${issuedAt} AS issued_on,
              p.business_name, p.city, p.region
         FROM ${table} d
         JOIN providers p ON p.id = d.provider_id
        WHERE d.id = $1`,
      [id],
    );

    const doc = rows[0];
    // A miss and a draft read identically from outside, which is the point.
    if (!doc || doc.status === 'draft') throw notFound('That document was not found.');

    res.json({
      kind,
      number: doc.number,
      status: doc.status,
      issuedOn: doc.issued_on,
      currency: doc.currency,
      totalCents: doc.total_cents,
      /**
       * Null until the render job has run. Reported as null rather than
       * omitted so the page can say "not generated yet" instead of implying
       * the document failed a check it was never given.
       */
      digest: doc.pdf_sha256 ?? null,
      issuedBy: {
        businessName: doc.business_name,
        city: doc.city,
        region: doc.region,
      },
    });
  }),
);
