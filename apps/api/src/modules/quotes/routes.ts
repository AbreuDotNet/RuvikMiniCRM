import { Router } from 'express';
import { z } from 'zod';
import * as svc from './service.js';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate, requireProvider, requireRole, tenantId } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import { idempotency } from '../../middleware/idempotency.js';
import {
  validate, validated, uuidSchema, safeText, moneyCents, isoDate, billingLineSchema,
} from '../../middleware/validate.js';
import { paginationSchema, decodeCursor, buildPage } from '../../lib/pagination.js';

export const quotesRouter = Router();

const lineSchema = billingLineSchema;

const createSchema = z.object({
  jobId: uuidSchema,
  lines: z.array(lineSchema).min(1, 'Add at least one line item.').max(100),
  discountCents: moneyCents.default(0),
  currency: z.string().length(3).default('USD'),
  validUntil: isoDate.optional().nullable(),
  notes: safeText(2000).optional().nullable(),
  terms: safeText(2000).optional().nullable(),
});

/* ---------------------------- provider surface ---------------------------- */

quotesRouter.get(
  '/',
  authenticate,
  requireProvider,
  validate(
    paginationSchema.extend({
      status: z.enum(['draft', 'sent', 'accepted', 'declined', 'expired', 'cancelled']).optional(),
      jobId: uuidSchema.optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const f = validated<{ limit: number; cursor?: string; status?: string; jobId?: string }>(req);
    const params: unknown[] = [tenantId(req)];
    const where = ['q.provider_id = $1'];
    if (f.status) { params.push(f.status); where.push(`q.status = $${params.length}`); }
    if (f.jobId) { params.push(f.jobId); where.push(`q.job_id = $${params.length}`); }
    if (f.cursor) {
      const cur = decodeCursor(f.cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(q.created_at, q.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(f.limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      // The invoice already raised from this quote, if any. Matches the guard
      // in the invoice service exactly — a voided invoice does not block a new
      // one — so the list cannot offer a quote the server would then refuse.
      `SELECT q.id, q.created_at, q.number, q.status, q.total_cents, q.currency,
              q.valid_until, q.sent_at, q.accepted_at,
              j.id AS job_id, j.title AS job_title, c.full_name AS client_name,
              inv.id AS invoice_id, inv.number AS invoice_number, inv.status AS invoice_status
         FROM quotes q
         LEFT JOIN LATERAL (
           SELECT i.id, i.number, i.status
             FROM invoices i
            WHERE i.quote_id = q.id AND i.status <> 'void'
            ORDER BY i.created_at DESC
            LIMIT 1
         ) inv ON true
         JOIN jobs j ON j.id = q.job_id
         JOIN clients c ON c.id = j.client_id
        WHERE ${where.join(' AND ')}
        ORDER BY q.created_at DESC, q.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = buildPage(rows, f.limit);
    res.json({
      data: page.data.map((q) => ({
        id: q.id, number: q.number, status: q.status, totalCents: q.total_cents,
        currency: q.currency, validUntil: q.valid_until, sentAt: q.sent_at,
        acceptedAt: q.accepted_at, createdAt: q.created_at,
        job: { id: q.job_id, title: q.job_title }, clientName: q.client_name,
        invoice: q.invoice_id
          ? { id: q.invoice_id, number: q.invoice_number, status: q.invoice_status }
          : null,
      })),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: f.limit },
    });
  }),
);

quotesRouter.post(
  '/',
  authenticate,
  requireProvider,
  limiters.financial,
  idempotency('quotes.create'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await svc.createQuote(tenantId(req), req.auth!.userId, req.body));
  }),
);

quotesRouter.patch(
  '/:id',
  authenticate,
  requireProvider,
  limiters.financial,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(createSchema.partial().omit({ jobId: true })),
  asyncHandler(async (req, res) => {
    res.json(await svc.updateQuote(tenantId(req), req.params.id, req.auth!.userId, req.body));
  }),
);

quotesRouter.post(
  '/:id/send',
  authenticate,
  requireProvider,
  limiters.financial,
  idempotency('quotes.send'),
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    const result = await svc.sendQuote(tenantId(req), req.params.id, req.auth!.userId);
    res.json({
      id: result.id,
      status: result.status,
      message: 'Quote sent. The PDF is being prepared and will attach shortly.',
    });
  }),
);

/* ------------------------- shared read + customer ------------------------- */

quotesRouter.get(
  '/:id',
  authenticate,
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    res.json(
      await svc.getQuote(req.params.id, {
        providerId: req.auth!.role === 'provider' ? req.auth!.providerId : undefined,
        userId: req.auth!.userId,
      }),
    );
  }),
);

quotesRouter.post(
  '/:id/respond',
  authenticate,
  requireRole('customer'),
  limiters.financial,
  idempotency('quotes.respond'),
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    decision: z.enum(['accept', 'decline']),
    reason: safeText(500).optional(),
  })),
  asyncHandler(async (req, res) => {
    res.json(
      await svc.respondToQuote(req.params.id, req.auth!.userId, req.body.decision, req.body.reason),
    );
  }),
);
