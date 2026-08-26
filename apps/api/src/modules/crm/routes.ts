import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate, requireProvider, tenantId } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import { validate, validated, uuidSchema, safeText, phoneSchema, emailSchema } from '../../middleware/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { paginationSchema, decodeCursor, buildPage } from '../../lib/pagination.js';
import { nextNumber } from '../../lib/numbering.js';
import { canTransition, allowedNext, JOB_STATUSES, type JobStatus } from './jobStatus.js';
import { notify } from '../notifications/service.js';

export const crmRouter = Router();
crmRouter.use(authenticate, requireProvider);

const ctxOf = (req: any) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/* -------------------------------- clients -------------------------------- */

const clientSchema = z.object({
  fullName: safeText(120, 2),
  email: emailSchema.optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  whatsappPhone: phoneSchema.optional().nullable(),
  addressLine: safeText(200).optional().nullable(),
  city: safeText(80).optional().nullable(),
  tags: z.array(safeText(30)).max(10).optional(),
});

crmRouter.get(
  '/clients',
  validate(paginationSchema.extend({ q: z.string().trim().max(80).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { limit, cursor, q } = validated<{ limit: number; cursor?: string; q?: string }>(req);
    const params: unknown[] = [tenantId(req)];
    const where: string[] = ['c.provider_id = $1'];

    if (q) {
      params.push(q);
      where.push(`(c.search_doc @@ plainto_tsquery('simple', $${params.length})
                   OR c.full_name ILIKE '%' || $${params.length} || '%')`);
    }
    if (cursor) {
      const cur = decodeCursor(cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(c.created_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT c.id, c.created_at, c.full_name, c.email, c.phone_e164, c.whatsapp_phone_e164,
              c.city, c.tags, c.user_id,
              count(j.id)::text AS job_count,
              max(j.created_at) AS last_job_at
         FROM clients c
         LEFT JOIN jobs j ON j.client_id = c.id
        WHERE ${where.join(' AND ')}
        GROUP BY c.id
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = buildPage(rows, limit);
    res.json({
      data: page.data.map((c) => ({
        id: c.id,
        fullName: c.full_name,
        email: c.email,
        phone: c.phone_e164,
        whatsappPhone: c.whatsapp_phone_e164,
        city: c.city,
        tags: c.tags,
        isPlatformCustomer: Boolean(c.user_id),
        jobCount: Number(c.job_count),
        lastJobAt: c.last_job_at,
        createdAt: c.created_at,
      })),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit },
    });
  }),
);

crmRouter.post(
  '/clients',
  limiters.write,
  validate(clientSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof clientSchema>;
    const db = await getDb();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO clients (provider_id, full_name, email, phone_e164, whatsapp_phone_e164,
                            address_line, city, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tenantId(req), b.fullName, b.email ?? null, b.phone ?? null, b.whatsappPhone ?? null,
       b.addressLine ?? null, b.city ?? null, JSON.stringify(b.tags ?? [])],
    );
    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'provider', action: 'client.created',
      entityType: 'client', entityId: rows[0].id, ...ctxOf(req),
    });
    res.status(201).json({ id: rows[0].id });
  }),
);

crmRouter.get(
  '/clients/:id',
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT id, full_name, email, phone_e164, whatsapp_phone_e164, address_line, city,
              tags, user_id, created_at
         FROM clients WHERE id = $1 AND provider_id = $2`,
      [req.params.id, tenantId(req)],
    );
    const c = rows[0];
    if (!c) throw notFound('That client was not found.');

    const jobs = await db.query<any>(
      `SELECT id, reference, title, status, scheduled_start, completed_at, created_at
         FROM jobs WHERE client_id = $1 AND provider_id = $2
        ORDER BY created_at DESC LIMIT 50`,
      [req.params.id, tenantId(req)],
    );

    res.json({
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone_e164,
      whatsappPhone: c.whatsapp_phone_e164,
      addressLine: c.address_line,
      city: c.city,
      tags: c.tags,
      isPlatformCustomer: Boolean(c.user_id),
      createdAt: c.created_at,
      jobs: jobs.rows.map((j) => ({
        id: j.id,
        reference: j.reference,
        title: j.title,
        status: j.status,
        scheduledStart: j.scheduled_start,
        completedAt: j.completed_at,
        createdAt: j.created_at,
      })),
    });
  }),
);

crmRouter.patch(
  '/clients/:id',
  limiters.write,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(clientSchema.partial()),
  asyncHandler(async (req, res) => {
    const map: Record<string, string> = {
      fullName: 'full_name', email: 'email', phone: 'phone_e164',
      whatsappPhone: 'whatsapp_phone_e164', addressLine: 'address_line', city: 'city', tags: 'tags',
    };
    const body = req.body as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [req.params.id, tenantId(req)];
    for (const [key, column] of Object.entries(map)) {
      if (!(key in body)) continue;
      params.push(key === 'tags' ? JSON.stringify(body[key] ?? []) : body[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) throw badRequest('No changes were supplied.');
    sets.push('updated_at = now()');

    const db = await getDb();
    const { rowCount } = await db.query(
      `UPDATE clients SET ${sets.join(', ')} WHERE id = $1 AND provider_id = $2`,
      params,
    );
    if (!rowCount) throw notFound('That client was not found.');
    res.json({ message: 'Client updated.' });
  }),
);

/* --------------------------------- jobs ---------------------------------- */

const jobSchema = z.object({
  clientId: uuidSchema.optional(),
  newClient: clientSchema.optional(),
  serviceId: uuidSchema.optional().nullable(),
  title: safeText(160, 3),
  description: safeText(4000).optional().nullable(),
  addressLine: safeText(200).optional().nullable(),
  city: safeText(80).optional().nullable(),
  scheduledStart: z.string().datetime().optional().nullable(),
  scheduledEnd: z.string().datetime().optional().nullable(),
}).refine((v) => v.clientId || v.newClient, {
  message: 'Choose an existing client or provide new client details.',
  path: ['clientId'],
});

crmRouter.get(
  '/jobs',
  validate(
    paginationSchema.extend({
      status: z.enum(JOB_STATUSES).optional(),
      clientId: uuidSchema.optional(),
      q: z.string().trim().max(80).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const f = validated<{ limit: number; cursor?: string; status?: JobStatus; clientId?: string; q?: string }>(req);
    const params: unknown[] = [tenantId(req)];
    const where = ['j.provider_id = $1'];

    if (f.status) { params.push(f.status); where.push(`j.status = $${params.length}`); }
    if (f.clientId) { params.push(f.clientId); where.push(`j.client_id = $${params.length}`); }
    if (f.q) {
      params.push(f.q);
      where.push(`(j.title ILIKE '%' || $${params.length} || '%' OR j.reference ILIKE '%' || $${params.length} || '%')`);
    }
    if (f.cursor) {
      const cur = decodeCursor(f.cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(j.created_at, j.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(f.limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT j.id, j.created_at, j.reference, j.title, j.status, j.scheduled_start,
              j.completed_at, j.city,
              c.id AS client_id, c.full_name AS client_name, c.phone_e164 AS client_phone,
              (SELECT count(*)::text FROM quotes q WHERE q.job_id = j.id) AS quote_count,
              (SELECT count(*)::text FROM invoices i WHERE i.job_id = j.id) AS invoice_count
         FROM jobs j JOIN clients c ON c.id = j.client_id
        WHERE ${where.join(' AND ')}
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = buildPage(rows, f.limit);
    res.json({
      data: page.data.map(shapeJobRow),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: f.limit },
    });
  }),
);

crmRouter.post(
  '/jobs',
  limiters.write,
  validate(jobSchema),
  asyncHandler(async (req, res) => {
    const providerId = tenantId(req);
    const b = req.body as z.infer<typeof jobSchema>;
    const db = await getDb();

    const result = await db.tx(async (c) => {
      let clientId = b.clientId;
      if (!clientId && b.newClient) {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO clients (provider_id, full_name, email, phone_e164, whatsapp_phone_e164, city)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [providerId, b.newClient.fullName, b.newClient.email ?? null, b.newClient.phone ?? null,
           b.newClient.whatsappPhone ?? null, b.newClient.city ?? null],
        );
        clientId = rows[0].id;
      } else {
        // An id from the request body must be proven to belong to this tenant.
        const owned = await c.query('SELECT 1 FROM clients WHERE id = $1 AND provider_id = $2', [
          clientId, providerId,
        ]);
        if (!owned.rows.length) throw notFound('That client was not found.');
      }

      if (b.serviceId) {
        const owned = await c.query('SELECT 1 FROM services WHERE id = $1 AND provider_id = $2', [
          b.serviceId, providerId,
        ]);
        if (!owned.rows.length) throw notFound('That service listing was not found.');
      }

      const reference = await nextNumber(c, providerId, 'job');
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO jobs (provider_id, client_id, service_id, reference, title, description,
                           address_line, city, scheduled_start, scheduled_end, source, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual',
                 CASE WHEN $9::timestamptz IS NULL THEN 'new_lead' ELSE 'scheduled' END)
         RETURNING id`,
        [providerId, clientId, b.serviceId ?? null, reference, b.title, b.description ?? null,
         b.addressLine ?? null, b.city ?? null, b.scheduledStart ?? null, b.scheduledEnd ?? null],
      );
      await c.query(
        `INSERT INTO job_status_events (job_id, from_status, to_status, actor_user_id, note)
         VALUES ($1, NULL, 'new_lead', $2, 'Job created')`,
        [rows[0].id, req.auth!.userId],
      );
      return { id: rows[0].id, reference };
    });

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'provider', action: 'job.created',
      entityType: 'job', entityId: result.id, ...ctxOf(req),
    });
    res.status(201).json(result);
  }),
);

crmRouter.get(
  '/jobs/:id',
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    const providerId = tenantId(req);
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT j.*, c.full_name AS client_name, c.email AS client_email,
              c.phone_e164 AS client_phone, c.whatsapp_phone_e164 AS client_whatsapp,
              s.title AS service_title
         FROM jobs j
         JOIN clients c ON c.id = j.client_id
         LEFT JOIN services s ON s.id = j.service_id
        WHERE j.id = $1 AND j.provider_id = $2`,
      [req.params.id, providerId],
    );
    const j = rows[0];
    if (!j) throw notFound('That job was not found.');

    const [notes, quotes, invoices, events] = await Promise.all([
      db.query<any>(
        `SELECT n.id, n.body, n.visibility, n.created_at, u.full_name AS author_name
           FROM job_notes n JOIN users u ON u.id = n.author_user_id
          WHERE n.job_id = $1 ORDER BY n.created_at DESC`,
        [req.params.id],
      ),
      db.query<any>(
        `SELECT id, number, status, total_cents, currency, valid_until, sent_at, accepted_at, created_at
           FROM quotes WHERE job_id = $1 ORDER BY created_at DESC`,
        [req.params.id],
      ),
      db.query<any>(
        `SELECT id, number, status, total_cents, amount_paid_cents, currency, due_date, created_at
           FROM invoices WHERE job_id = $1 ORDER BY created_at DESC`,
        [req.params.id],
      ),
      db.query<any>(
        `SELECT from_status, to_status, note, created_at FROM job_status_events
          WHERE job_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.params.id],
      ),
    ]);

    res.json({
      id: j.id,
      reference: j.reference,
      title: j.title,
      description: j.description,
      status: j.status,
      allowedNextStatuses: allowedNext(j.status),
      source: j.source,
      addressLine: j.address_line,
      city: j.city,
      scheduledStart: j.scheduled_start,
      scheduledEnd: j.scheduled_end,
      completedAt: j.completed_at,
      cancelledAt: j.cancelled_at,
      cancelReason: j.cancel_reason,
      createdAt: j.created_at,
      serviceTitle: j.service_title,
      client: {
        id: j.client_id,
        fullName: j.client_name,
        email: j.client_email,
        phone: j.client_phone,
        whatsappPhone: j.client_whatsapp,
      },
      notes: notes.rows.map((n) => ({
        id: n.id, body: n.body, visibility: n.visibility,
        authorName: n.author_name, createdAt: n.created_at,
      })),
      quotes: quotes.rows.map((q) => ({
        id: q.id, number: q.number, status: q.status, totalCents: q.total_cents,
        currency: q.currency, validUntil: q.valid_until, sentAt: q.sent_at,
        acceptedAt: q.accepted_at, createdAt: q.created_at,
      })),
      invoices: invoices.rows.map((i) => ({
        id: i.id, number: i.number, status: i.status, totalCents: i.total_cents,
        amountPaidCents: i.amount_paid_cents, currency: i.currency,
        dueDate: i.due_date, createdAt: i.created_at,
      })),
      timeline: events.rows.map((e) => ({
        fromStatus: e.from_status, toStatus: e.to_status, note: e.note, createdAt: e.created_at,
      })),
    });
  }),
);

crmRouter.post(
  '/jobs/:id/status',
  limiters.write,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    status: z.enum(JOB_STATUSES),
    note: safeText(500).optional(),
    scheduledStart: z.string().datetime().optional().nullable(),
    scheduledEnd: z.string().datetime().optional().nullable(),
  })),
  asyncHandler(async (req, res) => {
    const providerId = tenantId(req);
    const { status, note, scheduledStart, scheduledEnd } = req.body;
    const db = await getDb();

    const outcome = await db.tx(async (c) => {
      const { rows } = await c.query<any>(
        'SELECT status, customer_user_id, reference, title FROM jobs WHERE id = $1 AND provider_id = $2',
        [req.params.id, providerId],
      );
      const job = rows[0];
      if (!job) throw notFound('That job was not found.');
      if (job.status === status) return { unchanged: true, job };

      if (!canTransition(job.status, status)) {
        throw conflict(
          `A job cannot move from "${job.status.replace(/_/g, ' ')}" to "${status.replace(/_/g, ' ')}".`,
          { allowed: allowedNext(job.status) },
        );
      }

      await c.query(
        `UPDATE jobs SET status = $3,
                scheduled_start = COALESCE($4, scheduled_start),
                scheduled_end   = COALESCE($5, scheduled_end),
                completed_at    = CASE WHEN $3 = 'completed' THEN now() ELSE completed_at END,
                cancelled_at    = CASE WHEN $3 = 'cancelled' THEN now() ELSE cancelled_at END,
                cancel_reason   = CASE WHEN $3 = 'cancelled' THEN $6 ELSE cancel_reason END,
                updated_at = now()
          WHERE id = $1 AND provider_id = $2`,
        [req.params.id, providerId, status, scheduledStart ?? null, scheduledEnd ?? null, note ?? null],
      );
      await c.query(
        `INSERT INTO job_status_events (job_id, from_status, to_status, actor_user_id, note)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, job.status, status, req.auth!.userId, note ?? null],
      );

      // completed_jobs backs the public profile counter.
      if (status === 'completed') {
        await c.query('UPDATE providers SET completed_jobs = completed_jobs + 1 WHERE id = $1', [providerId]);
      }
      return { unchanged: false, job };
    });

    if (!outcome.unchanged && outcome.job.customer_user_id) {
      await notify(outcome.job.customer_user_id, {
        type: `job.${status}`,
        title: statusHeadline(status),
        body: `${outcome.job.title} (${outcome.job.reference})`,
        data: { jobId: req.params.id, status },
      });
    }

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'provider', action: 'job.status_changed',
      entityType: 'job', entityId: req.params.id, ...ctxOf(req),
      metadata: { from: outcome.job.status, to: status },
    });

    res.json({ status, allowedNextStatuses: allowedNext(status) });
  }),
);

crmRouter.post(
  '/jobs/:id/notes',
  limiters.write,
  validate(z.object({ id: uuidSchema }), 'params'),
  validate(z.object({
    body: safeText(4000, 1),
    visibility: z.enum(['internal', 'customer']).default('internal'),
  })),
  asyncHandler(async (req, res) => {
    const providerId = tenantId(req);
    const db = await getDb();
    const owned = await db.query<{ customer_user_id: string | null; title: string }>(
      'SELECT customer_user_id, title FROM jobs WHERE id = $1 AND provider_id = $2',
      [req.params.id, providerId],
    );
    if (!owned.rows.length) throw notFound('That job was not found.');

    const { rows } = await db.query<{ id: string; created_at: string }>(
      `INSERT INTO job_notes (job_id, provider_id, author_user_id, body, visibility)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [req.params.id, providerId, req.auth!.userId, req.body.body, req.body.visibility],
    );

    // Only customer-visible comments generate a customer notification.
    if (req.body.visibility === 'customer' && owned.rows[0].customer_user_id) {
      await notify(owned.rows[0].customer_user_id, {
        type: 'job.comment',
        title: 'New message from your provider',
        body: owned.rows[0].title,
        data: { jobId: req.params.id },
      });
    }

    res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
  }),
);

/* ------------------------------- calendar -------------------------------- */

crmRouter.get(
  '/calendar',
  validate(z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const { from, to } = validated<{ from: string; to: string }>(req);
    if (new Date(to).getTime() - new Date(from).getTime() > 1000 * 60 * 60 * 24 * 92) {
      throw badRequest('Choose a range of 92 days or less.');
    }
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT j.id, j.reference, j.title, j.status, j.scheduled_start, j.scheduled_end,
              j.city, c.full_name AS client_name
         FROM jobs j JOIN clients c ON c.id = j.client_id
        WHERE j.provider_id = $1
          AND j.scheduled_start IS NOT NULL
          AND j.scheduled_start >= $2::timestamptz
          AND j.scheduled_start <  $3::timestamptz
        ORDER BY j.scheduled_start`,
      [tenantId(req), from, to],
    );
    res.json({
      data: rows.map((r) => ({
        id: r.id, reference: r.reference, title: r.title, status: r.status,
        scheduledStart: r.scheduled_start, scheduledEnd: r.scheduled_end,
        city: r.city, clientName: r.client_name,
      })),
    });
  }),
);

function shapeJobRow(j: any) {
  return {
    id: j.id,
    reference: j.reference,
    title: j.title,
    status: j.status,
    scheduledStart: j.scheduled_start,
    completedAt: j.completed_at,
    city: j.city,
    createdAt: j.created_at,
    client: { id: j.client_id, fullName: j.client_name, phone: j.client_phone },
    quoteCount: Number(j.quote_count),
    invoiceCount: Number(j.invoice_count),
  };
}

function statusHeadline(status: string): string {
  const map: Record<string, string> = {
    contacted: 'Your provider has been in touch',
    quoted: 'You have a new quote',
    approved: 'Your job was approved',
    scheduled: 'Your job has been scheduled',
    in_progress: 'Work has started',
    completed: 'Your job is complete',
    cancelled: 'Your job was cancelled',
  };
  return map[status] ?? 'Your job was updated';
}
