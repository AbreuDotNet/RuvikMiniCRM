import { Router } from 'express';
import { z } from 'zod';
import * as svc from './service.js';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate, requireProvider, tenantId } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import { idempotency } from '../../middleware/idempotency.js';
import {
  validate, validated, uuidSchema, safeText, moneyCents, isoDate, billingLineSchema,
} from '../../middleware/validate.js';
import { paginationSchema, decodeCursor, buildPage } from '../../lib/pagination.js';

export const invoicesRouter = Router();

const lineSchema = billingLineSchema;

const createSchema = z.object({
  jobId: uuidSchema.optional(),
  clientId: uuidSchema.optional(),
  fromQuoteId: uuidSchema.optional(),
  lines: z.array(lineSchema).max(100).optional(),
  discountCents: moneyCents.default(0),
  currency: z.string().length(3).default('USD'),
  issueDate: isoDate.optional(),
  dueDate: isoDate.optional().nullable(),
  notes: safeText(2000).optional().nullable(),
}).refine((v) => v.fromQuoteId || (v.lines && v.lines.length > 0), {
  message: 'Provide line items or an accepted quote to invoice from.',
  path: ['lines'],
});

invoicesRouter.get(
  '/',
  authenticate,
  requireProvider,
  validate(
    paginationSchema.extend({
      status: z.enum(['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void']).optional(),
      jobId: uuidSchema.optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const f = validated<{ limit: number; cursor?: string; status?: string; jobId?: string }>(req);
    const params: unknown[] = [tenantId(req)];
    const where = ['i.provider_id = $1'];
    if (f.status) { params.push(f.status); where.push(`i.status = $${params.length}`); }
    if (f.jobId) { params.push(f.jobId); where.push(`i.job_id = $${params.length}`); }
    if (f.cursor) {
      const cur = decodeCursor(f.cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(i.created_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(f.limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT i.id, i.created_at, i.number, i.status, i.total_cents, i.amount_paid_cents,
              i.currency, i.issue_date, i.due_date,
              c.full_name AS client_name, j.id AS job_id, j.title AS job_title
         FROM invoices i
         JOIN clients c ON c.id = i.client_id
         LEFT JOIN jobs j ON j.id = i.job_id
        WHERE ${where.join(' AND ')}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT $${params.length}`,
      params,
    );

    const totals = await db.query<{ outstanding: string; paid: string }>(
      `SELECT COALESCE(sum(total_cents - amount_paid_cents) FILTER
                (WHERE status IN ('sent','partially_paid','overdue')), 0)::text AS outstanding,
              COALESCE(sum(total_cents) FILTER (WHERE status = 'paid'), 0)::text AS paid
         FROM invoices WHERE provider_id = $1`,
      [tenantId(req)],
    );

    const page = buildPage(rows, f.limit);
    res.json({
      data: page.data.map((i) => ({
        id: i.id, number: i.number, status: i.status, totalCents: i.total_cents,
        amountPaidCents: i.amount_paid_cents, balanceCents: i.total_cents - i.amount_paid_cents,
        currency: i.currency, issueDate: i.issue_date, dueDate: i.due_date,
        createdAt: i.created_at, clientName: i.client_name,
        job: i.job_id ? { id: i.job_id, title: i.job_title } : null,
      })),
      summary: {
        outstandingCents: Number(totals.rows[0].outstanding),
        paidCents: Number(totals.rows[0].paid),
      },
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: f.limit },
    });
  }),
);

invoicesRouter.post(
  '/',
  authenticate,
  requireProvider,
  limiters.financial,
  idempotency('invoices.create'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await svc.createInvoice(tenantId(req), req.auth!.userId, req.body));
  }),
);

invoicesRouter.post(
  '/:id/send',
  authenticate,
  requireProvider,
  limiters.financial,
  idempotency('invoices.send'),
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    const result = await svc.sendInvoice(tenantId(req), req.params.id, req.auth!.userId);
    res.json({ id: result.id, status: result.status, message: 'Invoice sent.' });
  }),
);

invoicesRouter.post(
  '/:id/payments',
  authenticate,
  requireProvider,
  limiters.financial,
  idempotency('invoices.payment'),
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    amountCents: moneyCents.refine((v) => v > 0, 'Enter an amount greater than zero.'),
    method: z.enum(['cash', 'card', 'transfer', 'manual', 'other']).default('manual'),
    reference: safeText(100).optional(),
  })),
  asyncHandler(async (req, res) => {
    res.json(await svc.recordPayment(tenantId(req), req.params.id, req.auth!.userId, req.body));
  }),
);

invoicesRouter.get(
  '/:id',
  authenticate,
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    res.json(
      await svc.getInvoice(req.params.id, {
        providerId: req.auth!.role === 'provider' ? req.auth!.providerId : undefined,
        userId: req.auth!.userId,
      }),
    );
  }),
);

/**
 * Voids an invoice, freeing its quote to be invoiced again.
 *
 * A reason is required: a cancelled financial document with no explanation is
 * exactly what an audit stops on.
 */
invoicesRouter.post(
  '/:id/void',
  authenticate,
  requireProvider,
  limiters.financial,
  idempotency('invoices.void'),
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({ reason: safeText(300, 3) })),
  asyncHandler(async (req, res) => {
    const result = await svc.voidInvoice(
      tenantId(req), req.params.id, req.auth!.userId, (req.body as { reason: string }).reason,
    );
    res.json({ ...result, message: 'Invoice voided.' });
  }),
);
