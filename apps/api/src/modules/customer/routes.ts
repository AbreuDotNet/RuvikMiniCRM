import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import { idempotency } from '../../middleware/idempotency.js';
import { validate, validated, uuidSchema, safeText, phoneSchema } from '../../middleware/validate.js';
import { paginationSchema, decodeCursor, buildPage } from '../../lib/pagination.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { nextNumber } from '../../lib/numbering.js';
import { writeAudit } from '../../lib/audit.js';
import { notify } from '../notifications/service.js';

export const customerRouter = Router();
customerRouter.use(authenticate, requireRole('customer'));

const ctxOf = (req: any) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/* ----------------------------- quote requests ----------------------------- */

const requestSchema = z.object({
  providerId: uuidSchema,
  serviceId: uuidSchema.optional().nullable(),
  title: safeText(160, 3),
  description: safeText(2000, 10),
  addressLine: safeText(200).optional().nullable(),
  city: safeText(80).optional().nullable(),
  phone: phoneSchema.optional(),
  preferredDate: z.string().datetime().optional().nullable(),
});

/**
 * A customer request becomes a `new_lead` job in the provider's CRM, plus a
 * client record linking the platform account to that provider's book.
 */
customerRouter.post(
  '/requests',
  limiters.write,
  idempotency('customer.requests.create'),
  validate(requestSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof requestSchema>;
    const db = await getDb();

    const result = await db.tx(async (c) => {
      const { rows: provRows } = await c.query<any>(
        `SELECT p.id, p.business_name, p.user_id
           FROM providers p JOIN users u ON u.id = p.user_id
          WHERE p.id = $1 AND p.is_published = true AND u.status = 'active'`,
        [b.providerId],
      );
      const provider = provRows[0];
      if (!provider) throw notFound('That provider is not available.');

      if (b.serviceId) {
        const owned = await c.query(
          `SELECT 1 FROM services WHERE id = $1 AND provider_id = $2 AND status = 'active'`,
          [b.serviceId, b.providerId],
        );
        if (!owned.rows.length) throw notFound('That service is not available.');
      }

      const { rows: userRows } = await c.query<any>(
        'SELECT full_name, email, phone_e164 FROM users WHERE id = $1',
        [req.auth!.userId],
      );
      const me = userRows[0];

      // One client record per (provider, platform customer).
      const { rows: clientRows } = await c.query<{ id: string }>(
        `INSERT INTO clients (provider_id, user_id, full_name, email, phone_e164, address_line, city)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (provider_id, user_id) WHERE user_id IS NOT NULL
         DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = now()
         RETURNING id`,
        [b.providerId, req.auth!.userId, me.full_name, me.email,
         b.phone ?? me.phone_e164, b.addressLine ?? null, b.city ?? null],
      );

      const reference = await nextNumber(c, b.providerId, 'job');
      const { rows: jobRows } = await c.query<{ id: string }>(
        `INSERT INTO jobs (provider_id, client_id, customer_user_id, service_id, reference,
                           title, description, address_line, city, scheduled_start,
                           source, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'quote_request','new_lead')
         RETURNING id`,
        [b.providerId, clientRows[0].id, req.auth!.userId, b.serviceId ?? null, reference,
         b.title, b.description, b.addressLine ?? null, b.city ?? null, b.preferredDate ?? null],
      );

      await c.query(
        `INSERT INTO job_status_events (job_id, from_status, to_status, actor_user_id, note)
         VALUES ($1, NULL, 'new_lead', $2, 'Request submitted by customer')`,
        [jobRows[0].id, req.auth!.userId],
      );

      await notify(provider.user_id, {
        type: 'lead.new',
        title: 'New quote request',
        body: `${me.full_name} — ${b.title}`,
        data: { jobId: jobRows[0].id, reference },
      }, c);

      return { id: jobRows[0].id, reference, providerName: provider.business_name };
    });

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'customer', action: 'request.created',
      entityType: 'job', entityId: result.id, ...ctxOf(req),
    });

    res.status(201).json(result);
  }),
);

customerRouter.get(
  '/requests',
  validate(paginationSchema.extend({ status: z.string().max(20).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const f = validated<{ limit: number; cursor?: string; status?: string }>(req);
    const params: unknown[] = [req.auth!.userId];
    const where = ['j.customer_user_id = $1'];
    if (f.status) { params.push(f.status); where.push(`j.status = $${params.length}`); }
    if (f.cursor) {
      const cur = decodeCursor(f.cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(j.created_at, j.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(f.limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT j.id, j.created_at, j.reference, j.title, j.status, j.scheduled_start, j.completed_at,
              p.id AS provider_id, p.slug AS provider_slug, p.business_name, p.rating_avg,
              (SELECT count(*)::text FROM quotes q WHERE q.job_id = j.id AND q.status <> 'draft') AS quote_count,
              (SELECT count(*)::text FROM invoices i WHERE i.job_id = j.id AND i.status <> 'draft') AS invoice_count,
              EXISTS (SELECT 1 FROM reviews r WHERE r.job_id = j.id) AS has_review
         FROM jobs j JOIN providers p ON p.id = j.provider_id
        WHERE ${where.join(' AND ')}
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = buildPage(rows, f.limit);
    res.json({
      data: page.data.map((r) => ({
        id: r.id, reference: r.reference, title: r.title, status: r.status,
        scheduledStart: r.scheduled_start, completedAt: r.completed_at, createdAt: r.created_at,
        quoteCount: Number(r.quote_count), invoiceCount: Number(r.invoice_count),
        canReview: r.status === 'completed' && !r.has_review,
        provider: {
          id: r.provider_id, slug: r.provider_slug,
          businessName: r.business_name, ratingAvg: Number(r.rating_avg),
        },
      })),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: f.limit },
    });
  }),
);

customerRouter.get(
  '/requests/:id',
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT j.id, j.reference, j.title, j.description, j.status, j.address_line, j.city,
              j.scheduled_start, j.scheduled_end, j.completed_at, j.created_at,
              p.id AS provider_id, p.slug AS provider_slug, p.business_name,
              p.phone_e164 AS provider_phone, p.rating_avg
         FROM jobs j JOIN providers p ON p.id = j.provider_id
        WHERE j.id = $1 AND j.customer_user_id = $2`,
      [req.params.id, req.auth!.userId],
    );
    const j = rows[0];
    if (!j) throw notFound('That request was not found.');

    const [quotes, invoices, comments, review] = await Promise.all([
      db.query<any>(
        `SELECT id, number, status, total_cents, currency, valid_until, sent_at, accepted_at
           FROM quotes WHERE job_id = $1 AND status <> 'draft' ORDER BY created_at DESC`,
        [req.params.id],
      ),
      db.query<any>(
        `SELECT id, number, status, total_cents, amount_paid_cents, currency, due_date
           FROM invoices WHERE job_id = $1 AND status <> 'draft' ORDER BY created_at DESC`,
        [req.params.id],
      ),
      // Internal provider notes are excluded at the query level, not filtered later.
      db.query<any>(
        `SELECT n.id, n.body, n.created_at, u.full_name AS author_name
           FROM job_notes n JOIN users u ON u.id = n.author_user_id
          WHERE n.job_id = $1 AND n.visibility = 'customer'
          ORDER BY n.created_at DESC`,
        [req.params.id],
      ),
      db.query<any>('SELECT id, rating, comment FROM reviews WHERE job_id = $1', [req.params.id]),
    ]);

    res.json({
      id: j.id,
      reference: j.reference,
      title: j.title,
      description: j.description,
      status: j.status,
      addressLine: j.address_line,
      city: j.city,
      scheduledStart: j.scheduled_start,
      scheduledEnd: j.scheduled_end,
      completedAt: j.completed_at,
      createdAt: j.created_at,
      canReview: j.status === 'completed' && review.rows.length === 0,
      myReview: review.rows[0] ?? null,
      provider: {
        id: j.provider_id, slug: j.provider_slug, businessName: j.business_name,
        phone: j.provider_phone, ratingAvg: Number(j.rating_avg),
      },
      quotes: quotes.rows.map((q) => ({
        id: q.id, number: q.number, status: q.status, totalCents: q.total_cents,
        currency: q.currency, validUntil: q.valid_until, sentAt: q.sent_at, acceptedAt: q.accepted_at,
      })),
      invoices: invoices.rows.map((i) => ({
        id: i.id, number: i.number, status: i.status, totalCents: i.total_cents,
        amountPaidCents: i.amount_paid_cents, currency: i.currency, dueDate: i.due_date,
      })),
      comments: comments.rows.map((c) => ({
        id: c.id, body: c.body, authorName: c.author_name, createdAt: c.created_at,
      })),
    });
  }),
);

/* -------------------------------- reviews -------------------------------- */

customerRouter.post(
  '/requests/:id/review',
  limiters.write,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    rating: z.number().int().min(1).max(5),
    comment: safeText(1500).optional(),
  })),
  asyncHandler(async (req, res) => {
    const db = await getDb();

    const result = await db.tx(async (c) => {
      const { rows } = await c.query<any>(
        'SELECT id, provider_id, status, customer_user_id FROM jobs WHERE id = $1',
        [req.params.id],
      );
      const job = rows[0];
      if (!job || job.customer_user_id !== req.auth!.userId) throw notFound('That request was not found.');
      // Reviews are earned: only a completed job the reviewer actually booked.
      if (job.status !== 'completed') {
        throw conflict('You can leave a review once the job is marked complete.');
      }

      const existing = await c.query('SELECT 1 FROM reviews WHERE job_id = $1', [req.params.id]);
      if (existing.rows.length) throw conflict('You have already reviewed this job.');

      const { rows: revRows } = await c.query<{ id: string }>(
        `INSERT INTO reviews (job_id, provider_id, customer_user_id, rating, comment)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.params.id, job.provider_id, req.auth!.userId, req.body.rating, req.body.comment ?? null],
      );

      // Recompute from source rather than incrementing a running average.
      await c.query(
        `UPDATE providers p SET
            rating_avg = COALESCE((SELECT round(avg(rating)::numeric, 2) FROM reviews
                                    WHERE provider_id = p.id AND status = 'published'), 0),
            rating_count = (SELECT count(*) FROM reviews
                             WHERE provider_id = p.id AND status = 'published')
          WHERE p.id = $1`,
        [job.provider_id],
      );

      const { rows: provRows } = await c.query<{ user_id: string }>(
        'SELECT user_id FROM providers WHERE id = $1',
        [job.provider_id],
      );
      await notify(provRows[0].user_id, {
        type: 'review.received',
        title: `New ${req.body.rating}-star review`,
        body: req.body.comment ?? 'A customer rated your work.',
        data: { jobId: req.params.id, reviewId: revRows[0].id },
      }, c);

      return { id: revRows[0].id };
    });

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'customer', action: 'review.created',
      entityType: 'review', entityId: result.id, ...ctxOf(req),
      metadata: { rating: req.body.rating },
    });

    res.status(201).json(result);
  }),
);

/* ------------------------------- home feed -------------------------------- */

customerRouter.get(
  '/home',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const [recent, unread] = await Promise.all([
      db.query<any>(
        `SELECT j.id, j.reference, j.title, j.status, j.created_at, p.business_name, p.slug
           FROM jobs j JOIN providers p ON p.id = j.provider_id
          WHERE j.customer_user_id = $1
          ORDER BY j.created_at DESC LIMIT 5`,
        [req.auth!.userId],
      ),
      db.query<{ count: string }>(
        'SELECT count(*)::text FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [req.auth!.userId],
      ),
    ]);
    res.json({
      recentRequests: recent.rows.map((r) => ({
        id: r.id, reference: r.reference, title: r.title, status: r.status,
        createdAt: r.created_at, providerName: r.business_name, providerSlug: r.slug,
      })),
      unreadNotifications: Number(unread.rows[0].count),
    });
  }),
);
