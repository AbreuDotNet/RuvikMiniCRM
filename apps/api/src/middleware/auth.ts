import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type Role } from '../lib/tokens.js';
import { getDb } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export interface AuthContext {
  userId: string;
  role: Role;
  providerId?: string;
  aal: 'aal1' | 'mfa';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
    }
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

/**
 * Verifies the access token and re-checks live account status on every
 * request: a suspended or deleted account must lose access immediately,
 * not when its 15-minute token happens to expire.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractBearer(req);
    if (!token) throw unauthorized('Please sign in to continue.');

    const claims = await verifyAccessToken(token);
    const db = await getDb();
    const { rows } = await db.query<{ status: string; role: Role; deleted_at: string | null }>(
      'SELECT status, role, deleted_at FROM users WHERE id = $1',
      [claims.sub],
    );
    const user = rows[0];
    if (!user || user.deleted_at) throw unauthorized('Account not found.');
    if (user.status === 'suspended') throw forbidden('This account has been suspended.');
    if (user.status !== 'active') throw forbidden('This account is not active.');
    // The DB is the source of truth for role, not the token.
    if (user.role !== claims.role) throw unauthorized('Session is stale. Please sign in again.');

    req.auth = {
      userId: claims.sub,
      role: user.role,
      providerId: claims.pid,
      aal: claims.aal ?? 'aal1',
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Attaches auth context when a token is present, but never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearer(req);
  if (!token) return next();
  try {
    const claims = await verifyAccessToken(token);
    req.auth = {
      userId: claims.sub,
      role: claims.role,
      providerId: claims.pid,
      aal: claims.aal ?? 'aal1',
    };
  } catch {
    /* anonymous */
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };
}

/** Admin actions that change money, permissions or account state need MFA. */
export function requireMfa(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.aal !== 'mfa') {
    return next(forbidden('This action requires two-factor authentication.'));
  }
  next();
}

/**
 * Resolves the caller's provider id and pins it on the request. Every
 * provider-scoped query must filter by req.providerId — never by an id
 * taken from the URL or body.
 */
export async function requireProvider(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw unauthorized();
    if (req.auth.role !== 'provider') throw forbidden('This area is for service providers.');

    let providerId = req.auth.providerId;
    if (!providerId) {
      const db = await getDb();
      const { rows } = await db.query<{ id: string }>(
        'SELECT id FROM providers WHERE user_id = $1',
        [req.auth.userId],
      );
      if (!rows[0]) throw forbidden('Finish setting up your business profile first.');
      providerId = rows[0].id;
      req.auth.providerId = providerId;
    }
    (req as Request & { providerId: string }).providerId = providerId;
    next();
  } catch (err) {
    next(err);
  }
}

/** Typed accessor so route handlers cannot forget the tenant filter. */
export function tenantId(req: Request): string {
  const id = (req as Request & { providerId?: string }).providerId;
  if (!id) throw forbidden('Provider context missing.');
  return id;
}
