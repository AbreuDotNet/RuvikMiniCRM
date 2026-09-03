import { Router } from 'express';
import { z } from 'zod';
import * as svc from './service.js';
import { validate, emailSchema, passwordSchema, phoneSchema, safeText } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { limiters, clientIp } from '../../middleware/rateLimit.js';
import { rotateRefreshToken, revokeByToken, signAccessToken } from '../../lib/tokens.js';
import { getDb } from '../../db/index.js';
import { unauthorized } from '../../lib/errors.js';

export const authRouter = Router();

const ctxOf = (req: any) => ({ ip: clientIp(req), userAgent: req.headers['user-agent'] });

/**
 * Refresh tokens live in an httpOnly cookie for browsers (immune to XSS
 * exfiltration) and are also returned in the body for native mobile clients,
 * which have no cookie jar and store them in the OS keychain.
 */
const REFRESH_COOKIE = 'ruvik_rt';
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: safeText(120, 2),
  phone: phoneSchema.optional(),
  role: z.enum(['customer', 'provider']),
  businessName: safeText(120, 2).optional(),
  city: safeText(80).optional(),
});

authRouter.post(
  '/signup',
  limiters.signup,
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    const session = await svc.signup(req.body, ctxOf(req));
    res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions);
    res.status(201).json(session);
  }),
);

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

authRouter.post(
  '/login',
  limiters.auth,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await svc.login(req.body.email, req.body.password, ctxOf(req));
    if (result.status === 'mfa_required') {
      return res.status(200).json({ status: 'mfa_required', mfaToken: result.mfaToken });
    }
    res.cookie(REFRESH_COOKIE, result.session!.refreshToken, cookieOptions);
    res.json({ status: 'ok', ...result.session });
  }),
);

authRouter.post(
  '/mfa/verify',
  limiters.auth,
  validate(z.object({ mfaToken: z.string().min(10).max(200), code: z.string().min(6).max(12) })),
  asyncHandler(async (req, res) => {
    const session = await svc.verifyMfa(req.body.mfaToken, req.body.code, ctxOf(req));
    res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions);
    res.json({ status: 'ok', ...session });
  }),
);

authRouter.post(
  '/refresh',
  limiters.refresh,
  asyncHandler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    if (typeof presented !== 'string' || !presented) throw unauthorized('No session to refresh.');

    const { userId, refresh, aal } = await rotateRefreshToken(presented, ctxOf(req));
    const db = await getDb();
    const { rows } = await db.query<{ role: any }>('SELECT role FROM users WHERE id = $1', [userId]);
    const { rows: prov } = await db.query<{ id: string }>(
      'SELECT id FROM providers WHERE user_id = $1',
      [userId],
    );

    const accessToken = await signAccessToken({
      userId,
      role: rows[0].role,
      providerId: prov[0]?.id ?? null,
      // Without this the token was re-minted at aal1, so an MFA-elevated
      // admin silently lost access to every requireMfa route one token
      // lifetime after signing in.
      aal,
    });

    res.cookie(REFRESH_COOKIE, refresh.token, cookieOptions);
    res.json({ accessToken, refreshToken: refresh.token, expiresIn: 900 });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    if (typeof presented === 'string' && presented) await revokeByToken(presented);
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  }),
);

authRouter.post(
  '/password/forgot',
  limiters.passwordReset,
  validate(z.object({ email: emailSchema })),
  asyncHandler(async (req, res) => {
    await svc.requestPasswordReset(req.body.email, ctxOf(req));
    // Always 202: the response must not reveal whether the account exists.
    res.status(202).json({
      message: 'If an account exists for that email, a reset link is on its way.',
    });
  }),
);

authRouter.post(
  '/password/reset',
  limiters.passwordReset,
  validate(z.object({ token: z.string().min(10).max(200), password: passwordSchema })),
  asyncHandler(async (req, res) => {
    await svc.resetPassword(req.body.token, req.body.password, ctxOf(req));
    res.json({ message: 'Your password has been updated. Please sign in.' });
  }),
);

/* --------------------------- authenticated area --------------------------- */

authRouter.post(
  '/password/change',
  authenticate,
  limiters.write,
  validate(z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })),
  asyncHandler(async (req, res) => {
    await svc.changePassword(req.auth!.userId, req.body.currentPassword, req.body.newPassword, ctxOf(req));
    res.json({ message: 'Password updated. Please sign in again on your other devices.' });
  }),
);

authRouter.post(
  '/mfa/enroll',
  authenticate,
  limiters.write,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rows } = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [
      req.auth!.userId,
    ]);
    res.json(await svc.beginMfaEnrollment(req.auth!.userId, rows[0].email));
  }),
);

authRouter.post(
  '/mfa/confirm',
  authenticate,
  limiters.write,
  validate(z.object({ code: z.string().min(6).max(8) })),
  asyncHandler(async (req, res) => {
    res.json(await svc.confirmMfaEnrollment(req.auth!.userId, req.body.code, ctxOf(req)));
  }),
);

authRouter.post(
  '/mfa/disable',
  authenticate,
  limiters.write,
  validate(z.object({ password: z.string().min(1).max(128) })),
  asyncHandler(async (req, res) => {
    await svc.disableMfa(req.auth!.userId, req.body.password, ctxOf(req));
    res.json({ message: 'Two-factor authentication is now off.' });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({
      user: await svc.loadPublicUser(req.auth!.userId),
      // The session's auth level, not the account's. The admin panel uses it
      // to explain up front that a state-changing action needs two-factor,
      // rather than letting someone write a reason and then hit a 403.
      sessionAal: req.auth!.aal,
    });
  }),
);
