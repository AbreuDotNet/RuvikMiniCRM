import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import { validate, safeText, phoneSchema } from '../../middleware/validate.js';
import * as whatsapp from '../whatsapp/service.js';
import { verifyPassword } from '../../lib/crypto.js';
import { revokeAllForUser } from '../../lib/tokens.js';
import { writeAudit } from '../../lib/audit.js';
import { unauthorized, conflict, notFound } from '../../lib/errors.js';

export const accountRouter = Router();
accountRouter.use(authenticate);

const ctxOf = (req: any) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/* -------------------------------- profile -------------------------------- */

accountRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT u.id, u.email, u.full_name, u.phone_e164, u.role, u.locale, u.mfa_enabled,
              u.whatsapp_opt_in, u.whatsapp_phone_e164, u.created_at, u.last_login_at,
              cp.city, cp.region, cp.country, cp.address_line
         FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id
        WHERE u.id = $1`,
      [req.auth!.userId],
    );
    const u = rows[0];
    if (!u) throw notFound('Account not found.');
    res.json({
      id: u.id, email: u.email, fullName: u.full_name, phone: u.phone_e164,
      role: u.role, locale: u.locale, mfaEnabled: u.mfa_enabled,
      whatsappOptIn: u.whatsapp_opt_in, whatsappPhone: u.whatsapp_phone_e164,
      city: u.city, region: u.region, country: u.country, addressLine: u.address_line,
      createdAt: u.created_at, lastLoginAt: u.last_login_at,
    });
  }),
);

accountRouter.patch(
  '/profile',
  limiters.write,
  validate(z.object({
    fullName: safeText(120, 2).optional(),
    phone: phoneSchema.optional().nullable(),
    locale: z.enum(['en', 'es']).optional(),
    city: safeText(80).optional().nullable(),
    region: safeText(80).optional().nullable(),
    addressLine: safeText(200).optional().nullable(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    const db = await getDb();

    await db.tx(async (c) => {
      const userSets: string[] = [];
      const userParams: unknown[] = [req.auth!.userId];
      for (const [key, column] of Object.entries({ fullName: 'full_name', phone: 'phone_e164', locale: 'locale' })) {
        if (!(key in b)) continue;
        userParams.push(b[key]);
        userSets.push(`${column} = $${userParams.length}`);
      }
      if (userSets.length) {
        await c.query(
          `UPDATE users SET ${userSets.join(', ')}, updated_at = now() WHERE id = $1`,
          userParams,
        );
      }

      if (req.auth!.role === 'customer') {
        const profSets: string[] = [];
        const profParams: unknown[] = [req.auth!.userId];
        for (const [key, column] of Object.entries({
          city: 'city', region: 'region', addressLine: 'address_line',
        })) {
          if (!(key in b)) continue;
          profParams.push(b[key]);
          profSets.push(`${column} = $${profParams.length}`);
        }
        if (profSets.length) {
          await c.query(
            `UPDATE customer_profiles SET ${profSets.join(', ')}, updated_at = now() WHERE user_id = $1`,
            profParams,
          );
        }
      }
    });

    res.json({ message: 'Profile updated.' });
  }),
);

/* --------------------------- WhatsApp consent ----------------------------- */

accountRouter.get(
  '/whatsapp-consent',
  asyncHandler(async (req, res) => {
    res.json(await whatsapp.getConsent(req.auth!.userId));
  }),
);

/**
 * Opt-in is an affirmative action with an explicit acknowledgement flag —
 * a pre-ticked box or an implied consent would not meet WhatsApp policy.
 */
accountRouter.post(
  '/whatsapp-consent',
  limiters.write,
  validate(z.object({
    phone: phoneSchema,
    acknowledged: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm you agree to receive WhatsApp messages.' }),
    }),
  })),
  asyncHandler(async (req, res) => {
    res.json(await whatsapp.optIn(req.auth!.userId, req.body.phone, 'settings_ui', ctxOf(req)));
  }),
);

accountRouter.delete(
  '/whatsapp-consent',
  limiters.write,
  asyncHandler(async (req, res) => {
    res.json(await whatsapp.optOut(req.auth!.userId, 'settings_ui', ctxOf(req)));
  }),
);

/* ------------------------------ data export ------------------------------ */

/**
 * GDPR art. 20 portability: everything the platform holds about the caller,
 * in a machine-readable form, scoped strictly to their own records.
 */
accountRouter.get(
  '/export',
  limiters.financial,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const userId = req.auth!.userId;

    const [user, notifications, consents, requests, reviews, provider] = await Promise.all([
      db.query<any>(
        `SELECT id, email, full_name, phone_e164, role, locale, created_at, last_login_at,
                whatsapp_opt_in, whatsapp_phone_e164
           FROM users WHERE id = $1`,
        [userId],
      ),
      db.query<any>(
        'SELECT type, title, body, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000',
        [userId],
      ),
      db.query<any>(
        'SELECT action, source, created_at FROM whatsapp_consents WHERE user_id = $1 ORDER BY created_at',
        [userId],
      ),
      db.query<any>(
        `SELECT j.reference, j.title, j.description, j.status, j.created_at, p.business_name
           FROM jobs j JOIN providers p ON p.id = j.provider_id
          WHERE j.customer_user_id = $1 ORDER BY j.created_at DESC`,
        [userId],
      ),
      db.query<any>(
        `SELECT r.rating, r.comment, r.created_at, p.business_name
           FROM reviews r JOIN providers p ON p.id = r.provider_id
          WHERE r.customer_user_id = $1`,
        [userId],
      ),
      db.query<any>(
        `SELECT business_name, slug, bio, city, country, created_at, rating_avg, rating_count
           FROM providers WHERE user_id = $1`,
        [userId],
      ),
    ]);

    await writeAudit({
      actorUserId: userId, actorRole: req.auth!.role, action: 'account.data_exported',
      entityType: 'user', entityId: userId, ...ctxOf(req),
    });

    res.setHeader('Content-Disposition', 'attachment; filename="ruvik-data-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      account: user.rows[0],
      providerProfile: provider.rows[0] ?? null,
      requests: requests.rows,
      reviews: reviews.rows,
      notifications: notifications.rows,
      whatsappConsentHistory: consents.rows,
    });
  }),
);

/* ---------------------------- account deletion ---------------------------- */

/**
 * Deletion is a two-step, password-confirmed request. Financial records
 * (invoices, payments) are retained under statutory bookkeeping duties, so
 * personal data is anonymised rather than the rows being dropped.
 */
accountRouter.post(
  '/delete',
  limiters.financial,
  validate(z.object({
    password: z.string().min(1).max(128),
    confirmation: z.literal('DELETE'),
  })),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<{ password_hash: string; role: string }>(
      'SELECT password_hash, role FROM users WHERE id = $1',
      [req.auth!.userId],
    );
    if (!rows[0] || !(await verifyPassword(rows[0].password_hash, req.body.password))) {
      throw unauthorized('Password is incorrect.');
    }

    if (rows[0].role === 'provider') {
      const open = await db.query<{ count: string }>(
        `SELECT count(*)::text FROM invoices i
           JOIN providers p ON p.id = i.provider_id
          WHERE p.user_id = $1 AND i.status IN ('sent','partially_paid','overdue')`,
        [req.auth!.userId],
      );
      if (Number(open.rows[0].count) > 0) {
        throw conflict('Settle or void your outstanding invoices before deleting your account.');
      }
    }

    await db.query(
      `UPDATE users SET status = 'pending_deletion', updated_at = now() WHERE id = $1`,
      [req.auth!.userId],
    );
    await revokeAllForUser(req.auth!.userId, 'account_deletion');

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: req.auth!.role, action: 'account.deletion_requested',
      entityType: 'user', entityId: req.auth!.userId, ...ctxOf(req),
    });

    res.json({
      message: 'Your account is scheduled for deletion. Contact support within 30 days to restore it.',
      scheduledFor: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
  }),
);
