import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate, requireRole, requireMfa } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import { validate, validated, uuidSchema, safeText } from '../../middleware/validate.js';
import {
  paginationSchema, decodeCursor, buildPage,
  keysetOrderBy, keysetWhere, decodeKeyset, buildKeysetPage, type SortColumn,
} from '../../lib/pagination.js';
import { writeAudit, verifyAuditChain } from '../../lib/audit.js';
import { revokeAllForUser } from '../../lib/tokens.js';
import { notify } from '../notifications/service.js';
import { queueDepth } from '../../lib/queue.js';
import { notFound, badRequest } from '../../lib/errors.js';
import {
  EFFECTIVE_STATES, VERIFICATION_STATUSES, PROVIDER_ACTIONS,
  effectiveState, allowedActions, actionForLegacyStatus,
} from '../../lib/providerLifecycle.js';
import { applyProviderAction } from './providerService.js';

export const adminRouter = Router();
// Every admin route: authenticated, role-checked, and rate limited tighter
// than the rest of the platform. State-changing routes add requireMfa.
adminRouter.use(authenticate, requireRole('admin'), limiters.admin);

const ctxOf = (req: any) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/**
 * Effective provider state, derived in SQL so filtering and counting agree
 * with `effectiveState()` in the lifecycle module. Account status wins over
 * verification: whether someone may operate matters more than whether we
 * checked their paperwork.
 */
const STATE_SQL = `CASE
  WHEN u.status = 'blocked' THEN 'blocked'
  WHEN u.status = 'suspended' THEN 'suspended'
  WHEN u.status IN ('pending_deletion','deleted') THEN 'closed'
  ELSE p.verification_status
END`;

/* ------------------------------- dashboard -------------------------------- */

adminRouter.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const db = await getDb();
    const [users, providers, commerce, subs, moderation, queue, reviewQueue, activity] =
      await Promise.all([
        db.query<any>(
          `SELECT count(*) FILTER (WHERE role = 'customer')::text AS customers,
                  count(*) FILTER (WHERE role = 'provider')::text AS providers,
                  count(*) FILTER (WHERE status = 'suspended')::text AS suspended,
                  count(*) FILTER (WHERE status = 'blocked')::text AS blocked,
                  count(*) FILTER (WHERE created_at > now() - interval '30 days')::text AS new_30d
             FROM users WHERE deleted_at IS NULL`,
        ),
        // Counted off the derived state rather than verification_status alone.
        // The old dashboard counted a suspended provider as "verified" too, so
        // the buckets never summed to the provider total.
        db.query<any>(
          `SELECT count(*) FILTER (WHERE st = 'pending')::text        AS pending,
                  count(*) FILTER (WHERE st = 'info_requested')::text AS info_requested,
                  count(*) FILTER (WHERE st = 'verified')::text       AS verified,
                  count(*) FILTER (WHERE st = 'rejected')::text       AS rejected,
                  count(*) FILTER (WHERE st = 'unverified')::text     AS unverified,
                  count(*) FILTER (WHERE st = 'suspended')::text      AS suspended,
                  count(*) FILTER (WHERE st = 'blocked')::text        AS blocked,
                  count(*) FILTER (WHERE is_published)::text          AS published,
                  count(*)::text                                      AS total
             FROM (SELECT ${STATE_SQL} AS st, p.is_published
                     FROM providers p JOIN users u ON u.id = p.user_id) s`,
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
        // Oldest first: a queue sorted newest-first starves the submission that
        // has been waiting longest, which is the one that matters.
        db.query<any>(
          `SELECT p.id, p.business_name, p.city, p.region,
                  ${STATE_SQL} AS st,
                  COALESCE(p.verification_requested_at, p.created_at) AS waiting_since
             FROM providers p JOIN users u ON u.id = p.user_id
            WHERE ${STATE_SQL} IN ('pending','info_requested')
            ORDER BY waiting_since ASC
            LIMIT 6`,
        ),
        db.query<any>(
          `SELECT a.id, a.action, a.actor_role, a.entity_type, a.entity_id,
                  a.metadata, a.created_at, u.full_name AS actor_name
             FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
            WHERE a.action LIKE 'admin.%'
            ORDER BY a.id DESC LIMIT 8`,
        ),
      ]);

    const p = providers.rows[0];
    res.json({
      users: {
        customers: Number(users.rows[0].customers),
        providers: Number(users.rows[0].providers),
        suspended: Number(users.rows[0].suspended),
        blocked: Number(users.rows[0].blocked),
        newLast30Days: Number(users.rows[0].new_30d),
      },
      providers: {
        // Kept under its original name as well: the dashboard is not the only
        // consumer of this payload.
        pendingVerification: Number(p.pending),
        pending: Number(p.pending),
        infoRequested: Number(p.info_requested),
        verified: Number(p.verified),
        rejected: Number(p.rejected),
        unverified: Number(p.unverified),
        suspended: Number(p.suspended),
        blocked: Number(p.blocked),
        published: Number(p.published),
        total: Number(p.total),
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
      reviewQueue: reviewQueue.rows.map((r: any) => ({
        id: r.id,
        businessName: r.business_name,
        city: r.city,
        region: r.region,
        state: r.st,
        waitingSince: r.waiting_since,
      })),
      recentActivity: activity.rows.map((a: any) => ({
        id: Number(a.id),
        action: a.action,
        actorRole: a.actor_role,
        actorName: a.actor_name,
        entityType: a.entity_type,
        entityId: a.entity_id,
        metadata: a.metadata,
        createdAt: a.created_at,
      })),
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
      status: z.enum(['active', 'suspended', 'blocked', 'pending_deletion']).optional(),
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
              u.status_reason, u.status_changed_at,
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
        statusReason: u.status_reason, statusChangedAt: u.status_changed_at,
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
    status: z.enum(['active', 'suspended', 'blocked']),
    reason: safeText(500),
  })),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    // An admin must not be able to lock themselves out of the platform.
    if (req.params.id === req.auth!.userId) {
      throw badRequest('You cannot change your own account status.');
    }

    const { rows } = await db.query<{ role: string; status: string; provider_id: string | null }>(
      `SELECT u.role, u.status, p.id AS provider_id
         FROM users u LEFT JOIN providers p ON p.user_id = u.id
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [req.params.id],
    );
    if (!rows[0]) throw notFound('User not found.');

    // Idempotent: asking for the status the account already has is a no-op
    // rather than a conflict, because a double-submit must not become an error.
    if (rows[0].status === req.body.status) {
      res.json({ id: req.params.id, status: req.body.status });
      return;
    }

    // A provider's account status is one axis of its lifecycle, so it goes
    // through the same machine: same transition rules, same history, one
    // place where "suspend" is defined.
    if (rows[0].provider_id) {
      const action =
        req.body.status === 'suspended' ? 'suspend'
          : req.body.status === 'blocked' ? 'block'
            : rows[0].status === 'blocked' ? 'unblock' : 'reinstate';

      const outcome = await applyProviderAction({
        providerId: rows[0].provider_id,
        action,
        reason: req.body.reason,
        actorUserId: req.auth!.userId,
        ctx: ctxOf(req),
      });
      res.json({ id: req.params.id, status: outcome.accountStatus });
      return;
    }

    await db.query(
      `UPDATE users SET status = $2, status_reason = $3, status_changed_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [req.params.id, req.body.status, req.body.reason],
    );

    // Suspension must take effect immediately, not when tokens expire.
    if (req.body.status !== 'active') {
      await revokeAllForUser(req.params.id, 'admin_suspension');
    }

    await notify(req.params.id, {
      type: req.body.status === 'active' ? 'account.reinstated' : `account.${req.body.status}`,
      title: req.body.status === 'active'
        ? 'Your account is active again'
        : `Your account has been ${req.body.status}`,
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

const PROVIDER_SORTS = {
  /** Default: most recently joined first. Matches every other admin list. */
  newest: [
    { sql: 'p.created_at', direction: 'DESC', nulls: 'LAST', type: 'timestamptz' },
    { sql: 'p.id', direction: 'DESC', nulls: 'LAST', type: 'uuid' },
  ],
  /** Review queue order: whoever has been waiting longest comes first. */
  waiting: [
    {
      sql: 'COALESCE(p.verification_requested_at, p.created_at)',
      direction: 'ASC', nulls: 'LAST', type: 'timestamptz',
    },
    { sql: 'p.id', direction: 'ASC', nulls: 'LAST', type: 'uuid' },
  ],
} satisfies Record<string, SortColumn[]>;

adminRouter.get(
  '/providers',
  validate(
    z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().max(400).optional(),
      /** Effective state — the merged verification/account status. */
      state: z.enum(EFFECTIVE_STATES).optional(),
      /** Retained for callers written against the verification-only filter. */
      verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
      q: z.string().trim().max(120).optional(),
      sort: z.enum(['newest', 'waiting']).default('newest'),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const f = validated<any>(req);
    const columns: SortColumn[] = PROVIDER_SORTS[f.sort as keyof typeof PROVIDER_SORTS];

    const params: unknown[] = [];
    const push = (value: unknown) => { params.push(value); return `$${params.length}`; };
    const where: string[] = ['1=1'];

    if (f.state) where.push(`${STATE_SQL} = ${push(f.state)}`);
    if (f.verificationStatus) where.push(`p.verification_status = ${push(f.verificationStatus)}`);
    if (f.q) {
      // Business name, owner name and owner email: the three things an admin
      // has to hand when somebody writes in about an account.
      const term = push(f.q);
      where.push(
        `(p.business_name ILIKE '%' || ${term} || '%'
          OR u.email ILIKE '%' || ${term} || '%'
          OR u.full_name ILIKE '%' || ${term} || '%')`,
      );
    }
    if (f.cursor) {
      where.push(keysetWhere(columns, decodeKeyset(f.cursor, columns), push));
    }

    const limitParam = push(f.limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT p.id, p.created_at, p.business_name, p.slug, p.city, p.region,
              p.verification_status, p.verification_note, p.verified_at,
              p.verification_requested_at, p.is_published,
              p.rating_avg, p.rating_count, p.completed_jobs,
              ${STATE_SQL} AS state,
              COALESCE(p.verification_requested_at, p.created_at) AS waiting_since,
              u.email, u.full_name, u.status AS user_status,
              u.status_reason, u.status_changed_at,
              s.status AS subscription_status,
              (SELECT count(*)::text FROM services WHERE provider_id = p.id) AS service_count
         FROM providers p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN subscriptions s ON s.provider_id = p.id
              AND s.status IN ('pending_payment','trialing','active','past_due')
        WHERE ${where.join(' AND ')}
        ORDER BY ${keysetOrderBy(columns)}
        LIMIT ${limitParam}`,
      params,
    );

    const page = buildKeysetPage(rows, f.limit, (r: any) => (
      f.sort === 'waiting'
        ? [isoOrNull(r.waiting_since), r.id]
        : [isoOrNull(r.created_at), r.id]
    ));

    res.json({
      data: page.data.map(providerSummary),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: f.limit },
    });
  }),
);

/**
 * Everything the review drawer needs in one round trip: the merged state, the
 * actions legal from it, the owner, and the decision history. Splitting this
 * across calls would let the drawer render actions against a state it has not
 * finished loading.
 */
adminRouter.get(
  '/providers/:id',
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT p.*, ${STATE_SQL} AS state,
              COALESCE(p.verification_requested_at, p.created_at) AS waiting_since,
              u.id AS owner_id, u.email, u.full_name, u.status AS user_status,
              u.status_reason, u.status_changed_at, u.mfa_enabled, u.last_login_at,
              u.created_at AS owner_created_at,
              s.status AS subscription_status,
              (SELECT count(*)::text FROM services WHERE provider_id = p.id) AS service_count,
              (SELECT count(*)::text FROM jobs WHERE provider_id = p.id) AS job_count,
              (SELECT count(*)::text FROM reviews WHERE provider_id = p.id AND status = 'flagged')
                AS flagged_review_count
         FROM providers p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN subscriptions s ON s.provider_id = p.id
              AND s.status IN ('pending_payment','trialing','active','past_due')
        WHERE p.id = $1`,
      [req.params.id],
    );
    const row = rows[0];
    if (!row) throw notFound('Provider not found.');

    const { rows: history } = await db.query<any>(
      `SELECT e.id, e.axis, e.action, e.from_status, e.to_status, e.reason,
              e.created_at, u.full_name AS actor_name, u.email AS actor_email
         FROM provider_status_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.provider_id = $1
        ORDER BY e.id DESC LIMIT 40`,
      [req.params.id],
    );

    // Documents uploaded for review. Quarantined uploads are listed with their
    // scan state rather than hidden: "nothing here" and "three files still
    // being scanned" call for different decisions.
    const { rows: documents } = await db.query<any>(
      `SELECT id, original_name, mime_type, size_bytes, kind, scan_status, created_at
         FROM files
        WHERE provider_id = $1 AND kind IN ('document','image')
        ORDER BY created_at DESC LIMIT 20`,
      [req.params.id],
    );

    const state = effectiveState({
      verificationStatus: row.verification_status,
      accountStatus: row.user_status,
    });

    res.json({
      ...providerSummary(row),
      tagline: row.tagline,
      bio: row.bio,
      phone: row.phone_e164,
      addressLine: row.address_line,
      postalCode: row.postal_code,
      country: row.country,
      yearsExperience: row.years_experience,
      certifications: row.certifications ?? [],
      jobCount: Number(row.job_count),
      flaggedReviewCount: Number(row.flagged_review_count),
      owner: {
        id: row.owner_id,
        email: row.email,
        fullName: row.full_name,
        status: row.user_status,
        statusReason: row.status_reason,
        statusChangedAt: row.status_changed_at,
        mfaEnabled: row.mfa_enabled,
        lastLoginAt: row.last_login_at,
        joinedAt: row.owner_created_at,
      },
      /* The server is the authority on what is legal here; the drawer renders
         exactly this list rather than deciding for itself. */
      availableActions: allowedActions(state).map((spec) => ({
        action: spec.action,
        label: spec.label,
        description: spec.description,
        tone: spec.tone,
        requiresReason: spec.requiresReason,
        requiresConfirmation: spec.requiresConfirmation,
        confirmBody: spec.confirmBody ?? null,
      })),
      history: history.map((h) => ({
        id: Number(h.id),
        axis: h.axis,
        action: h.action,
        fromStatus: h.from_status,
        toStatus: h.to_status,
        reason: h.reason,
        actorName: h.actor_name,
        actorEmail: h.actor_email,
        createdAt: h.created_at,
      })),
      documents: documents.map((d) => ({
        id: d.id,
        name: d.original_name,
        mimeType: d.mime_type,
        sizeBytes: Number(d.size_bytes),
        kind: d.kind,
        scanStatus: d.scan_status,
        uploadedAt: d.created_at,
      })),
    });
  }),
);

/** The lifecycle endpoint. Every provider state change goes through here. */
adminRouter.post(
  '/providers/:id/actions',
  requireMfa,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    action: z.enum(PROVIDER_ACTIONS),
    reason: safeText(1000).optional(),
  })),
  asyncHandler(async (req, res) => {
    res.json(await applyProviderAction({
      providerId: req.params.id,
      action: req.body.action,
      reason: req.body.reason,
      actorUserId: req.auth!.userId,
      ctx: ctxOf(req),
    }));
  }),
);

/**
 * The original verification endpoint, which took a target status rather than
 * an action. Kept working — it is the documented shape and existing callers
 * use it — by translating the status into the action that reaches it from
 * wherever the provider currently stands.
 */
adminRouter.post(
  '/providers/:id/verification',
  requireMfa,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    status: z.enum(['pending', 'verified', 'rejected', 'unverified', 'info_requested']),
    note: safeText(1000).optional(),
  })),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<{ verification_status: string; user_status: string }>(
      `SELECT p.verification_status, u.status AS user_status
         FROM providers p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) throw notFound('Provider not found.');

    const state = effectiveState({
      verificationStatus: rows[0].verification_status,
      accountStatus: rows[0].user_status,
    });
    const action = actionForLegacyStatus(state, req.body.status);
    if (!action) throw badRequest(`Cannot move this provider to "${req.body.status}".`);

    const outcome = await applyProviderAction({
      providerId: req.params.id,
      action,
      reason: req.body.note,
      actorUserId: req.auth!.userId,
      ctx: ctxOf(req),
    });
    res.json({
      id: outcome.id,
      verificationStatus: outcome.verificationStatus,
      state: outcome.state,
    });
  }),
);

/** Row shape shared by the provider list and the provider detail view. */
function providerSummary(p: any) {
  return {
    id: p.id,
    businessName: p.business_name,
    slug: p.slug,
    city: p.city,
    region: p.region,
    state: p.state,
    verificationStatus: p.verification_status,
    verificationNote: p.verification_note,
    verifiedAt: p.verified_at,
    waitingSince: p.waiting_since ?? p.verification_requested_at ?? p.created_at,
    isPublished: p.is_published,
    ratingAvg: Number(p.rating_avg),
    ratingCount: p.rating_count,
    completedJobs: p.completed_jobs,
    serviceCount: Number(p.service_count),
    subscriptionStatus: p.subscription_status,
    createdAt: p.created_at,
    owner: {
      email: p.email,
      fullName: p.full_name,
      status: p.user_status,
      statusReason: p.status_reason ?? null,
      statusChangedAt: p.status_changed_at ?? null,
    },
  };
}

const isoOrNull = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

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
    entityId: z.string().max(64).optional(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const f = validated<any>(req);
    const params: unknown[] = [];
    const where = ['1=1'];
    if (f.before) { params.push(f.before); where.push(`id < $${params.length}`); }
    if (f.action) { params.push(f.action); where.push(`action = $${params.length}`); }
    if (f.actorUserId) { params.push(f.actorUserId); where.push(`actor_user_id = $${params.length}`); }
    if (f.entityType) { params.push(f.entityType); where.push(`entity_type = $${params.length}`); }
    if (f.entityId) { params.push(f.entityId); where.push(`entity_id = $${params.length}`); }
    // One extra row is the sentinel that tells the client whether to offer
    // another page; without it a caller can only guess from the page size.
    params.push(f.limit + 1);

    const db = await getDb();
    const { rows: fetched } = await db.query<any>(
      `SELECT id, actor_user_id, actor_role, action, entity_type, entity_id, ip,
              metadata, created_at
         FROM audit_logs WHERE ${where.join(' AND ')}
        ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    const hasMore = fetched.length > f.limit;
    const rows = hasMore ? fetched.slice(0, f.limit) : fetched;

    res.json({
      data: rows.map((r) => ({
        id: Number(r.id), actorUserId: r.actor_user_id, actorRole: r.actor_role,
        action: r.action, entityType: r.entity_type, entityId: r.entity_id,
        ip: r.ip, metadata: r.metadata, createdAt: r.created_at,
      })),
      nextBefore: hasMore && rows.length ? Number(rows[rows.length - 1].id) : null,
      hasMore,
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
