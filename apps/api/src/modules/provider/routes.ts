import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate, requireProvider, tenantId } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import {
  validate, validated, uuidSchema, safeText, phoneSchema, moneyCents, usStateSchema,
} from '../../middleware/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { signStorageUrl } from '../../lib/storage.js';
import { paginationSchema, decodeCursor, buildPage } from '../../lib/pagination.js';

export const providerRouter = Router();
providerRouter.use(authenticate, requireProvider);

const ctxOf = (req: any) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/* ------------------------------ profile ---------------------------------- */

const workingHoursSchema = z.record(
  z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
    closed: z.boolean().optional(),
  }),
).optional();

/**
 * Note what is absent: `verification_status`, `rating_avg`, `is_published`
 * beyond the explicit toggle, `slug`. A provider cannot mark itself verified
 * by adding a field to this payload — the schema simply drops unknown keys.
 */
const profileSchema = z.object({
  businessName: safeText(120, 2).optional(),
  tagline: safeText(160).optional().nullable(),
  bio: safeText(2000).optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  whatsappPhone: phoneSchema.optional().nullable(),
  addressLine: safeText(200).optional().nullable(),
  city: safeText(80).optional().nullable(),
  region: safeText(80).optional().nullable(),
  country: z.string().length(2).optional(),
  postalCode: safeText(20).optional().nullable(),
  serviceRadiusKm: z.number().int().min(1).max(500).optional(),
  yearsExperience: z.number().int().min(0).max(80).optional().nullable(),
  workingHours: workingHoursSchema,
  certifications: z.array(safeText(120)).max(20).optional(),
  isPublished: z.boolean().optional(),
});

const COLUMN_MAP: Record<string, string> = {
  businessName: 'business_name',
  tagline: 'tagline',
  bio: 'bio',
  phone: 'phone_e164',
  whatsappPhone: 'whatsapp_phone_e164',
  addressLine: 'address_line',
  city: 'city',
  region: 'region',
  country: 'country',
  postalCode: 'postal_code',
  serviceRadiusKm: 'service_radius_km',
  yearsExperience: 'years_experience',
  workingHours: 'working_hours',
  certifications: 'certifications',
  isPublished: 'is_published',
};

/**
 * Sales tax settings for this provider.
 *
 * Deliberately per provider and defaulting to zero. There is no federal sales
 * tax in the United States and no rate that is correct everywhere: five states
 * levy no general sales tax at all, and combined state-plus-local rates vary
 * by locality. A shipped default would be wrong for almost every user, so an
 * unset rate stays zero and the quote screen leaves the field blank rather
 * than inventing a figure.
 */
providerRouter.get(
  '/tax-settings',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT tax_state, default_tax_rate_bp, tax_jurisdiction_note
         FROM providers WHERE id = $1`,
      [tenantId(req)],
    );
    if (!rows.length) throw notFound('Provider profile not found.');
    res.json({
      taxState: rows[0].tax_state,
      defaultTaxRateBp: rows[0].default_tax_rate_bp,
      jurisdictionNote: rows[0].tax_jurisdiction_note,
    });
  }),
);

providerRouter.patch(
  '/tax-settings',
  validate(
    z.object({
      taxState: usStateSchema.optional().nullable(),
      /**
       * Capped at 15%. The highest US combined state-plus-local rate sits
       * around 12%, so anything above this is a typo or a rate meant for a
       * VAT country — this app previously defaulted to 18%, which is the
       * Dominican ITBIS and is not a US sales tax rate anywhere.
       */
      defaultTaxRateBp: z.number().int().min(0).max(1500).optional(),
      jurisdictionNote: safeText(200).optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    // `validated()` reads query params; this payload is a body.
    const input = req.body as {
      taxState?: string | null; defaultTaxRateBp?: number; jurisdictionNote?: string | null;
    };
    const db = await getDb();
    const { rows } = await db.query<any>(
      `UPDATE providers
          SET tax_state = COALESCE($2, tax_state),
              default_tax_rate_bp = COALESCE($3, default_tax_rate_bp),
              tax_jurisdiction_note = COALESCE($4, tax_jurisdiction_note),
              updated_at = now()
        WHERE id = $1
        RETURNING tax_state, default_tax_rate_bp, tax_jurisdiction_note`,
      [tenantId(req), input.taxState ?? null, input.defaultTaxRateBp ?? null,
       input.jurisdictionNote ?? null],
    );
    if (!rows.length) throw notFound('Provider profile not found.');

    // A rate change alters every document raised afterwards, so it belongs in
    // the audit trail rather than only in the row.
    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'provider', action: 'provider.tax_settings_updated',
      entityType: 'provider', entityId: tenantId(req),
      metadata: {
        taxState: rows[0].tax_state,
        defaultTaxRateBp: rows[0].default_tax_rate_bp,
      },
    });

    res.json({
      taxState: rows[0].tax_state,
      defaultTaxRateBp: rows[0].default_tax_rate_bp,
      jurisdictionNote: rows[0].tax_jurisdiction_note,
    });
  }),
);

providerRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT p.*, f.storage_key AS logo_key
         FROM providers p LEFT JOIN files f ON f.id = p.logo_file_id
        WHERE p.id = $1`,
      [tenantId(req)],
    );
    const p = rows[0];
    if (!p) throw notFound('Profile not found.');
    res.json({
      id: p.id,
      slug: p.slug,
      businessName: p.business_name,
      tagline: p.tagline,
      bio: p.bio,
      phone: p.phone_e164,
      whatsappPhone: p.whatsapp_phone_e164,
      addressLine: p.address_line,
      city: p.city,
      region: p.region,
      country: p.country,
      postalCode: p.postal_code,
      serviceRadiusKm: p.service_radius_km,
      yearsExperience: p.years_experience,
      workingHours: p.working_hours,
      certifications: p.certifications,
      verificationStatus: p.verification_status,
      verificationNote: p.verification_note,
      isPublished: p.is_published,
      ratingAvg: Number(p.rating_avg),
      ratingCount: p.rating_count,
      completedJobs: p.completed_jobs,
      logoUrl: p.logo_key ? signStorageUrl(p.logo_key, 3600) : null,
    });
  }),
);

providerRouter.patch(
  '/profile',
  limiters.write,
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    const providerId = tenantId(req);
    const body = req.body as Record<string, unknown>;

    const sets: string[] = [];
    const params: unknown[] = [providerId];
    for (const [key, column] of Object.entries(COLUMN_MAP)) {
      if (!(key in body)) continue;
      const value = body[key];
      params.push(
        key === 'workingHours' || key === 'certifications' ? JSON.stringify(value ?? (key === 'certifications' ? [] : {})) : value,
      );
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) throw badRequest('No changes were supplied.');
    sets.push('updated_at = now()');

    const db = await getDb();
    await db.query(`UPDATE providers SET ${sets.join(', ')} WHERE id = $1`, params);

    await writeAudit({
      actorUserId: req.auth!.userId,
      actorRole: 'provider',
      action: 'provider.profile_updated',
      entityType: 'provider',
      entityId: providerId,
      ...ctxOf(req),
      metadata: { fields: Object.keys(body) },
    });

    res.json({ message: 'Profile updated.' });
  }),
);

/* ------------------------------ services --------------------------------- */

const serviceBase = z.object({
  categoryId: uuidSchema,
  title: safeText(120, 3),
  shortDescription: safeText(200).optional().nullable(),
  description: safeText(4000).optional().nullable(),
  pricingType: z.enum(['fixed', 'starting_at', 'request_quote']),
  priceCents: moneyCents.optional().nullable(),
  currency: z.string().length(3).default('USD'),
  estimatedDurationMin: z.number().int().min(5).max(10_000).optional().nullable(),
  coverageArea: safeText(200).optional().nullable(),
  status: z.enum(['draft', 'active', 'paused']).default('draft'),
});

/**
 * Mirrors the DB CHECK constraint so the user gets a field-level message
 * instead of a 409 surfaced from Postgres.
 */
function checkPriceCoherence(
  val: { pricingType?: string; priceCents?: number | null },
  ctx: z.RefinementCtx,
) {
  if (val.pricingType === 'request_quote' && val.priceCents != null) {
    ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'Quote-based listings must not set a price.' });
  }
  if (
    val.pricingType && val.pricingType !== 'request_quote' &&
    (val.priceCents == null || val.priceCents <= 0)
  ) {
    ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'Set a price for this pricing type.' });
  }
}

const serviceSchema = serviceBase.superRefine(checkPriceCoherence);
/** On PATCH the rule only applies when the pricing type is part of the change. */
const servicePatchSchema = serviceBase.partial().superRefine(checkPriceCoherence);

providerRouter.get(
  '/services',
  validate(paginationSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { limit, cursor } = validated<{ limit: number; cursor?: string }>(req);
    const params: unknown[] = [tenantId(req)];
    let keyset = '';
    if (cursor) {
      const c = decodeCursor(cursor);
      params.push(c.createdAt, c.id);
      keyset = `AND (s.created_at, s.id) < ($2::timestamptz, $3::uuid)`;
    }
    params.push(limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT s.id, s.created_at, s.title, s.short_description, s.pricing_type, s.price_cents,
              s.currency, s.estimated_duration_min, s.coverage_area, s.status, s.photos,
              c.id AS category_id, c.name AS category_name, c.slug AS category_slug
         FROM services s JOIN categories c ON c.id = s.category_id
        WHERE s.provider_id = $1 ${keyset}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = buildPage(rows, limit);
    res.json({
      data: page.data.map(shapeService),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit },
    });
  }),
);

providerRouter.post(
  '/services',
  limiters.write,
  validate(serviceSchema),
  asyncHandler(async (req, res) => {
    const providerId = tenantId(req);
    const db = await getDb();

    // Plan limits are enforced server-side, never in the client.
    const { rows: planRows } = await db.query<{ max_services: number | null; count: string }>(
      `SELECT sp.max_services,
              (SELECT count(*)::text FROM services WHERE provider_id = $1) AS count
         FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
        WHERE s.provider_id = $1 AND s.status IN ('active','trialing')`,
      [providerId],
    );
    const plan = planRows[0];
    if (plan?.max_services != null && Number(plan.count) >= plan.max_services) {
      throw conflict(`Your plan includes ${plan.max_services} listings. Upgrade to add more.`);
    }

    const b = req.body as z.infer<typeof serviceSchema>;
    const { rows } = await db.query<any>(
      `INSERT INTO services (provider_id, category_id, title, short_description, description,
                             pricing_type, price_cents, currency, estimated_duration_min,
                             coverage_area, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, created_at`,
      [providerId, b.categoryId, b.title, b.shortDescription ?? null, b.description ?? null,
       b.pricingType, b.priceCents ?? null, b.currency, b.estimatedDurationMin ?? null,
       b.coverageArea ?? null, b.status],
    );

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'provider', action: 'service.created',
      entityType: 'service', entityId: rows[0].id, ...ctxOf(req),
    });

    res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
  }),
);

providerRouter.patch(
  '/services/:id',
  limiters.write,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(servicePatchSchema),
  asyncHandler(async (req, res) => {
    const providerId = tenantId(req);
    const db = await getDb();
    const body = req.body as Record<string, unknown>;

    const map: Record<string, string> = {
      categoryId: 'category_id', title: 'title', shortDescription: 'short_description',
      description: 'description', pricingType: 'pricing_type', priceCents: 'price_cents',
      currency: 'currency', estimatedDurationMin: 'estimated_duration_min',
      coverageArea: 'coverage_area', status: 'status',
    };
    const sets: string[] = [];
    const params: unknown[] = [req.params.id, providerId];
    for (const [key, column] of Object.entries(map)) {
      if (!(key in body)) continue;
      params.push(body[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) throw badRequest('No changes were supplied.');
    sets.push('updated_at = now()');

    // The tenant filter is in the WHERE clause, so another provider's id in
    // the URL simply matches nothing.
    const { rowCount } = await db.query(
      `UPDATE services SET ${sets.join(', ')} WHERE id = $1 AND provider_id = $2`,
      params,
    );
    if (!rowCount) throw notFound('That service listing was not found.');

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'provider', action: 'service.updated',
      entityType: 'service', entityId: req.params.id, ...ctxOf(req),
      metadata: { fields: Object.keys(body) },
    });
    res.json({ message: 'Listing updated.' });
  }),
);

providerRouter.delete(
  '/services/:id',
  limiters.write,
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rowCount } = await db.query(
      'DELETE FROM services WHERE id = $1 AND provider_id = $2',
      [req.params.id, tenantId(req)],
    );
    if (!rowCount) throw notFound('That service listing was not found.');
    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'provider', action: 'service.deleted',
      entityType: 'service', entityId: req.params.id, ...ctxOf(req),
    });
    res.status(204).end();
  }),
);

/* ------------------------------ dashboard -------------------------------- */

providerRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const providerId = tenantId(req);
    const db = await getDb();

    // One round trip per widget, run concurrently — not one query per row.
    const [leads, jobsByStatus, invoices, activity, subscription] = await Promise.all([
      db.query<{ count: string }>(
        `SELECT count(*)::text FROM jobs WHERE provider_id = $1 AND status = 'new_lead'`,
        [providerId],
      ),
      db.query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count FROM jobs WHERE provider_id = $1 GROUP BY status`,
        [providerId],
      ),
      db.query<{ outstanding: string; overdue: string }>(
        `SELECT
           COALESCE(sum(total_cents - amount_paid_cents) FILTER
             (WHERE status IN ('sent','partially_paid','overdue')), 0)::text AS outstanding,
           COALESCE(sum(total_cents - amount_paid_cents) FILTER
             (WHERE status = 'overdue'), 0)::text AS overdue
         FROM invoices WHERE provider_id = $1`,
        [providerId],
      ),
      db.query<{ month: string; completed: string; revenue: string }>(
        `SELECT to_char(date_trunc('month', j.completed_at), 'YYYY-MM') AS month,
                count(*)::text AS completed,
                COALESCE(sum(i.total_cents), 0)::text AS revenue
           FROM jobs j
           LEFT JOIN invoices i ON i.job_id = j.id AND i.status = 'paid'
          WHERE j.provider_id = $1 AND j.completed_at >= now() - interval '6 months'
          GROUP BY 1 ORDER BY 1`,
        [providerId],
      ),
      db.query<any>(
        `SELECT s.status, s.current_period_end, sp.name AS plan_name, sp.price_cents, sp.currency
           FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
          WHERE s.provider_id = $1
            AND s.status IN ('pending_payment','trialing','active','past_due')
          LIMIT 1`,
        [providerId],
      ),
    ]);

    const upcoming = await db.query<any>(
      `SELECT j.id, j.reference, j.title, j.scheduled_start, j.status, c.full_name AS client_name
         FROM jobs j JOIN clients c ON c.id = j.client_id
        WHERE j.provider_id = $1 AND j.scheduled_start >= now()
          AND j.status IN ('scheduled','approved','in_progress')
        ORDER BY j.scheduled_start ASC LIMIT 10`,
      [providerId],
    );

    const statusCounts = Object.fromEntries(jobsByStatus.rows.map((r) => [r.status, Number(r.count)]));

    res.json({
      newLeads: Number(leads.rows[0].count),
      upcomingJobs: (statusCounts.scheduled ?? 0) + (statusCounts.approved ?? 0),
      jobsByStatus: statusCounts,
      outstandingCents: Number(invoices.rows[0].outstanding),
      overdueCents: Number(invoices.rows[0].overdue),
      monthlyActivity: activity.rows.map((r) => ({
        month: r.month,
        completed: Number(r.completed),
        revenueCents: Number(r.revenue),
      })),
      upcomingSchedule: upcoming.rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        title: r.title,
        scheduledStart: r.scheduled_start,
        status: r.status,
        clientName: r.client_name,
      })),
      subscription: subscription.rows[0]
        ? {
            status: subscription.rows[0].status,
            planName: subscription.rows[0].plan_name,
            priceCents: subscription.rows[0].price_cents,
            currency: subscription.rows[0].currency,
            currentPeriodEnd: subscription.rows[0].current_period_end,
          }
        : null,
    });
  }),
);

function shapeService(s: any) {
  return {
    id: s.id,
    title: s.title,
    shortDescription: s.short_description,
    pricingType: s.pricing_type,
    priceCents: s.price_cents,
    currency: s.currency,
    estimatedDurationMin: s.estimated_duration_min,
    coverageArea: s.coverage_area,
    status: s.status,
    photos: s.photos,
    createdAt: s.created_at,
    category: { id: s.category_id, name: s.category_name, slug: s.category_slug },
  };
}
