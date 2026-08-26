import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate, requireRole, requireMfa } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import { validate, validated, uuidSchema, safeText } from '../../middleware/validate.js';
import { paginationSchema, decodeCursor, buildPage } from '../../lib/pagination.js';
import { writeAudit, verifyAuditChain } from '../../lib/audit.js';
import { revokeAllForUser } from '../../lib/tokens.js';
import { notify } from '../notifications/service.js';
import { queueDepth } from '../../lib/queue.js';
import { notFound, badRequest } from '../../lib/errors.js';

export const adminRouter = Router();
// Every admin route: authenticated, role-checked, and rate limited tighter
// than the rest of the platform. State-changing routes add requireMfa.
adminRouter.use(authenticate, requireRole('admin'), limiters.admin);

const ctxOf = (req: any) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/* ------------------------------- dashboard -------------------------------- */

adminRouter.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const db = await getDb();
    const [users, providers, commerce, subs, moderation, queue] = await Promise.all([
      db.query<any>(
        `SELECT count(*) FILTER (WHERE role = 'customer')::text AS customers,
                count(*) FILTER (WHERE role = 'provider')::text AS providers,
                count(*) FILTER (WHERE status = 'suspended')::text AS suspended,
                count(*) FILTER (WHERE created_at > now() - interval '30 days')::text AS new_30d
           FROM users WHERE deleted_at IS NULL`,
      ),
      db.query<any>(
        `SELECT count(*) FILTER (WHERE verification_status = 'pending')::text AS pending_verification,
                count(*) FILTER (WHERE verification_status = 'verified')::text AS verified,
                count(*) FILTER (WHERE is_published)::text AS published
           FROM providers`,
      ),
      db.query<any>(
        `SELECT (SELECT count(*)::text FROM jobs) AS jobs,
                (SELECT count(*)::text FROM jobs WHERE status = 'completed') AS completed_jobs,
                (SELECT count(*)::text FROM quotes) AS quotes,
                (SELECT count(*)::text FROM quotes WHERE status = 'accepted') AS accepted_quotes,
                (SELECT count(*)::text FROM invoices) AS invoices,
                (SELECT COALESCE(sum(total_cents),0)::text FROM invoices WHERE status = 'paid') AS gmv_cents`,
      ),
      db.query<any>(
        `SELECT count(*) FILTER (WHERE status = 'active')::text AS active,
                count(*) FILTER (WHERE status = 'past_due')::text AS past_due,
                COALESCE(sum(sp.price_cents) FILTER (WHERE s.status = 'active'),0)::text AS mrr_cents
           FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id`,
      ),
      db.query<any>(
        `SELECT (SELECT count(*)::text FROM reviews WHERE status = 'flagged') AS flagged_reviews,
                (SELECT count(*)::text FROM support_tickets WHERE status = 'open') AS open_tickets`,
      ),
      queueDepth(),
    ]);

    res.json({
      users: {
        customers: Number(users.rows[0].customers),
        providers: Number(users.rows[0].providers),
        suspended: Number(users.rows[0].suspended),
        newLast30Days: Number(users.rows[0].new_30d),
      },
      providers: {
        pendingVerification: Number(providers.rows[0].pending_verification),
        verified: Number(providers.rows[0].verified),
        published: Number(providers.rows[0].published),
      },
      commerce: {
        jobs: Number(commerce.rows[0].jobs),
        completedJobs: Number(commerce.rows[0].completed_jobs),
        quotes: Number(commerce.rows[0].quotes),
        acceptedQuotes: Number(commerce.rows[0].accepted_quotes),
        invoices: Number(commerce.rows[0].invoices),
        gmvCents: Number(commerce.rows[0].gmv_cents),
      },
      subscriptions: {
        active: Number(subs.rows[0].active),
        pastDue: Number(subs.rows[0].past_due),
        mrrCents: Number(subs.rows[0].mrr_cents),
      },
      moderation: {
        flaggedReviews: Number(moderation.rows[0].flagged_reviews),
        openTickets: Number(moderation.rows[0].open_tickets),
      },
      queue,
    });
  }),
);

/* --------------------------------- users ---------------------------------- */

adminRouter.get(
  '/users',
  validate(
    paginationSchema.extend({
      q: z.string().trim().max(120).optional(),
      role: z.enum(['admin', 'provider', 'customer']).optional(),
      status: z.enum(['active', 'suspended', 'pending_deletion']).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const f = validated<any>(req);
    const params: unknown[] = [];
    const where: string[] = ['u.deleted_at IS NULL'];

    if (f.q) {
      params.push(f.q);
      where.push(`(u.email ILIKE '%' || $${params.length} || '%' OR u.full_name ILIKE '%' || $${params.length} || '%')`);
    }
    if (f.role) { params.push(f.role); where.push(`u.role = $${params.length}`); }
    if (f.status) { params.push(f.status); where.push(`u.status = $${params.length}`); }
    if (f.cursor) {
      const cur = decodeCursor(f.cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(u.created_at, u.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(f.limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT u.id, u.created_at, u.email, u.full_name, u.role, u.status, u.mfa_enabled,
              u.last_login_at, p.id AS provider_id, p.business_name, p.verification_status
         FROM users u LEFT JOIN providers p ON p.user_id = u.id
        WHERE ${where.join(' AND ')}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = buildPage(rows, f.limit);
    res.json({
      data: page.data.map((u) => ({
        id: u.id, email: u.email, fullName: u.full_name, role: u.role, status: u.status,
        mfaEnabled: u.mfa_enabled, lastLoginAt: u.last_login_at, createdAt: u.created_at,
        provider: u.provider_id
          ? { id: u.provider_id, businessName: u.business_name, verificationStatus: u.verification_status }
          : null,
      })),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: f.limit },
    });
  }),
);

adminRouter.post(
  '/users/:id/status',
  requireMfa,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    status: z.enum(['active', 'suspended']),
    reason: safeText(500),
  })),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    // An admin must not be able to lock themselves out of the platform.
    if (req.params.id === req.auth!.userId) {
      throw badRequest('You cannot change your own account status.');
    }

    const { rows } = await db.query<{ role: string; status: string }>(
      'SELECT role, status FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!rows[0]) throw notFound('User not found.');

    await db.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [
      req.params.id, req.body.status,
    ]);

    // Suspension must take effect immediately, not when tokens expire.
    if (req.body.status === 'suspended') {
      await revokeAllForUser(req.params.id, 'admin_suspension');
      await db.query('UPDATE providers SET is_published = false WHERE user_id = $1', [req.params.id]);
    }

    await notify(req.params.id, {
      type: req.body.status === 'suspended' ? 'account.suspended' : 'account.reinstated',
      title: req.body.status === 'suspended' ? 'Your account has been suspended' : 'Your account is active again',
      body: req.body.reason,
      data: {},
    });

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'admin', action: `admin.user_${req.body.status}`,
      entityType: 'user', entityId: req.params.id, ...ctxOf(req),
      metadata: { reason: req.body.reason, previousStatus: rows[0].status },
    });

    res.json({ id: req.params.id, status: req.body.status });
  }),
);

/* ------------------------------- providers -------------------------------- */

adminRouter.get(
  '/providers',
  validate(
    paginationSchema.extend({
      verificationStatus: z.enum(['unverified', 'pending', 'verified', 'rejected']).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const f = validated<any>(req);
    const params: unknown[] = [];
    const where: string[] = ['1=1'];
    if (f.verificationStatus) {
      params.push(f.verificationStatus);
      where.push(`p.verification_status = $${params.length}`);
    }
    if (f.cursor) {
      const cur = decodeCursor(f.cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(f.limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT p.id, p.created_at, p.business_name, p.slug, p.city, p.verification_status,
              p.is_published, p.rating_avg, p.rating_count, p.completed_jobs,
              u.email, u.full_name, u.status AS user_status,
              s.status AS subscription_status,
              (SELECT count(*)::text FROM services WHERE provider_id = p.id) AS service_count
         FROM providers p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN subscriptions s ON s.provider_id = p.id
              AND s.status IN ('pending_payment','trialing','active','past_due')
        WHERE ${where.join(' AND ')}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = buildPage(rows, f.limit);
    res.json({
      data: page.data.map((p) => ({
        id: p.id, businessName: p.business_name, slug: p.slug, city: p.city,
        verificationStatus: p.verification_status, isPublished: p.is_published,
        ratingAvg: Number(p.rating_avg), ratingCount: p.rating_count,
        completedJobs: p.completed_jobs, serviceCount: Number(p.service_count),
        subscriptionStatus: p.subscription_status, createdAt: p.created_at,
        owner: { email: p.email, fullName: p.full_name, status: p.user_status },
      })),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: f.limit },
    });
  }),
);

adminRouter.post(
  '/providers/:id/verification',
  requireMfa,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    status: z.enum(['pending', 'verified', 'rejected', 'unverified']),
    note: safeText(500).optional(),
  })),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<{ user_id: string; business_name: string }>(
      'SELECT user_id, business_name FROM providers WHERE id = $1',
      [req.params.id],
    );
    if (!rows[0]) throw notFound('Provider not found.');

    await db.query(
      `UPDATE providers SET verification_status = $2, verification_note = $3,
              verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END,
              is_published = CASE WHEN $2 = 'rejected' THEN false ELSE is_published END,
              updated_at = now()
        WHERE id = $1`,
      [req.params.id, req.body.status, req.body.note ?? null],
    );

    await notify(rows[0].user_id, {
      type: `provider.verification_${req.body.status}`,
      title: req.body.status === 'verified' ? 'Your business is verified' : 'Verification update',
      body: req.body.note ?? `Your verification status is now ${req.body.status}.`,
      data: { providerId: req.params.id },
    });

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'admin', action: 'admin.provider_verification',
      entityType: 'provider', entityId: req.params.id, ...ctxOf(req),
      metadata: { status: req.body.status, note: req.body.note },
    });

    res.json({ id: req.params.id, verificationStatus: req.body.status });
  }),
);

/* ------------------------------- categories ------------------------------- */

adminRouter.post(
  '/categories',
  requireMfa,
  validate(z.object({
    slug: z.string().regex(/^[a-z0-9-]{2,60}$/, 'Use lowercase letters, numbers and dashes.'),
    name: safeText(80, 2),
    icon: z.string().max(40).default('wrench'),
    description: safeText(300).optional(),
    sortOrder: z.number().int().min(0).max(9999).default(100),
  })),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO categories (slug, name, icon, description, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.body.slug, req.body.name, req.body.icon, req.body.description ?? null, req.body.sortOrder],
    );
    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'admin', action: 'admin.category_created',
      entityType: 'category', entityId: rows[0].id, ...ctxOf(req),
    });
    res.status(201).json({ id: rows[0].id });
  }),
);

adminRouter.patch(
  '/categories/:id',
  requireMfa,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    name: safeText(80, 2).optional(),
    icon: z.string().max(40).optional(),
    description: safeText(300).optional().nullable(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })),
  asyncHandler(async (req, res) => {
    const map: Record<string, string> = {
      name: 'name', icon: 'icon', description: 'description',
      isActive: 'is_active', sortOrder: 'sort_order',
    };
    const sets: string[] = [];
    const params: unknown[] = [req.params.id];
    for (const [key, column] of Object.entries(map)) {
      if (!(key in req.body)) continue;
      params.push(req.body[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) throw badRequest('No changes were supplied.');

    const db = await getDb();
    const { rowCount } = await db.query(
      `UPDATE categories SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
    if (!rowCount) throw notFound('Category not found.');
    res.json({ id: req.params.id });
  }),
);

/* --------------------------- review moderation ---------------------------- */

adminRouter.get(
  '/reviews',
  validate(paginationSchema.extend({
    status: z.enum(['published', 'flagged', 'removed']).optional(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const f = validated<any>(req);
    const params: unknown[] = [];
    const where = ['1=1'];
    if (f.status) { params.push(f.status); where.push(`r.status = $${params.length}`); }
    if (f.cursor) {
      const cur = decodeCursor(f.cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(f.limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT r.id, r.created_at, r.rating, r.comment, r.status, r.moderation_note,
              p.business_name, u.full_name AS customer_name, j.reference
         FROM reviews r
         JOIN providers p ON p.id = r.provider_id
         JOIN users u ON u.id = r.customer_user_id
         JOIN jobs j ON j.id = r.job_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = buildPage(rows, f.limit);
    res.json({
      data: page.data.map((r) => ({
        id: r.id, rating: r.rating, comment: r.comment, status: r.status,
        moderationNote: r.moderation_note, createdAt: r.created_at,
        providerName: r.business_name, customerName: r.customer_name, jobReference: r.reference,
      })),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: f.limit },
    });
  }),
);

adminRouter.post(
  '/reviews/:id/moderate',
  requireMfa,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    status: z.enum(['published', 'flagged', 'removed']),
    note: safeText(500).optional(),
  })),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const result = await db.tx(async (c) => {
      const { rows } = await c.query<{ provider_id: string }>(
        'SELECT provider_id FROM reviews WHERE id = $1',
        [req.params.id],
      );
      if (!rows[0]) throw notFound('Review not found.');

      await c.query(
        `UPDATE reviews SET status = $2, moderation_note = $3, moderated_by = $4, updated_at = now()
          WHERE id = $1`,
        [req.params.id, req.body.status, req.body.note ?? null, req.auth!.userId],
      );
      // Removing a review must move the provider's public rating with it.
      await c.query(
        `UPDATE providers p SET
            rating_avg = COALESCE((SELECT round(avg(rating)::numeric,2) FROM reviews
                                    WHERE provider_id = p.id AND status = 'published'), 0),
            rating_count = (SELECT count(*) FROM reviews
                             WHERE provider_id = p.id AND status = 'published')
          WHERE p.id = $1`,
        [rows[0].provider_id],
      );
      return rows[0].provider_id;
    });

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'admin', action: 'admin.review_moderated',
      entityType: 'review', entityId: req.params.id, ...ctxOf(req),
      metadata: { status: req.body.status, providerId: result },
    });

    res.json({ id: req.params.id, status: req.body.status });
  }),
);

/* -------------------------------- audit ----------------------------------- */

adminRouter.get(
  '/audit-logs',
  validate(z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.coerce.number().int().optional(),
    action: z.string().max(60).optional(),
    actorUserId: uuidSchema.optional(),
    entityType: z.string().max(40).optional(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const f = validated<any>(req);
    const params: unknown[] = [];
    const where = ['1=1'];
    if (f.before) { params.push(f.before); where.push(`id < $${params.length}`); }
    if (f.action) { params.push(f.action); where.push(`action = $${params.length}`); }
    if (f.actorUserId) { params.push(f.actorUserId); where.push(`actor_user_id = $${params.length}`); }
    if (f.entityType) { params.push(f.entityType); where.push(`entity_type = $${params.length}`); }
    params.push(f.limit);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT id, actor_user_id, actor_role, action, entity_type, entity_id, ip,
              metadata, created_at
         FROM audit_logs WHERE ${where.join(' AND ')}
        ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    res.json({
      data: rows.map((r) => ({
        id: Number(r.id), actorUserId: r.actor_user_id, actorRole: r.actor_role,
        action: r.action, entityType: r.entity_type, entityId: r.entity_id,
        ip: r.ip, metadata: r.metadata, createdAt: r.created_at,
      })),
      nextBefore: rows.length ? Number(rows[rows.length - 1].id) : null,
    });
  }),
);

/** Re-walks the audit hash chain to prove no row was altered or removed. */
adminRouter.get(
  '/audit-logs/integrity',
  requireMfa,
  asyncHandler(async (_req, res) => {
    res.json(await verifyAuditChain());
  }),
);

/* ---------------------------- support tickets ----------------------------- */

adminRouter.get(
  '/support-tickets',
  validate(paginationSchema.extend({
    status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const f = validated<any>(req);
    const params: unknown[] = [];
    const where = ['1=1'];
    if (f.status) { params.push(f.status); where.push(`t.status = $${params.length}`); }
    if (f.cursor) {
      const cur = decodeCursor(f.cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(t.created_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(f.limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT t.id, t.created_at, t.subject, t.body, t.status, t.priority,
              u.email, u.full_name, u.role
         FROM support_tickets t JOIN users u ON u.id = t.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length}`,
      params,
    );
    const page = buildPage(rows, f.limit);
    res.json({
      data: page.data.map((t) => ({
        id: t.id, subject: t.subject, body: t.body, status: t.status,
        priority: t.priority, createdAt: t.created_at,
        user: { email: t.email, fullName: t.full_name, role: t.role },
      })),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: f.limit },
    });
  }),
);

adminRouter.post(
  '/support-tickets/:id',
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    status: z.enum(['open', 'pending', 'resolved', 'closed']),
  })),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rowCount } = await db.query(
      `UPDATE support_tickets SET status = $2, assigned_admin_id = $3, updated_at = now() WHERE id = $1`,
      [req.params.id, req.body.status, req.auth!.userId],
    );
    if (!rowCount) throw notFound('Ticket not found.');
    res.json({ id: req.params.id, status: req.body.status });
  }),
);
