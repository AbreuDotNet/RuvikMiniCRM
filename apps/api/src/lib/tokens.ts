import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { getDb } from '../db/index.js';
import { randomToken, sha256 } from './crypto.js';
import { unauthorized } from './errors.js';
import { logger } from './logger.js';

const ISSUER = 'ruvik';
const AUDIENCE = 'ruvik-api';
const secretKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export type Role = 'admin' | 'provider' | 'customer';

export interface AccessClaims extends JWTPayload {
  sub: string;
  role: Role;
  /** Provider id, present only for provider accounts. Drives tenant scoping. */
  pid?: string;
  /** Auth level: 'mfa' once a TOTP challenge has been satisfied this session. */
  aal: 'aal1' | 'mfa';
}

export async function signAccessToken(claims: {
  userId: string;
  role: Role;
  providerId?: string | null;
  aal?: 'aal1' | 'mfa';
}): Promise<string> {
  const jwt = new SignJWT({
    role: claims.role,
    ...(claims.providerId ? { pid: claims.providerId } : {}),
    aal: claims.aal ?? 'aal1',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setJti(randomToken(12))
    .setExpirationTime(`${env.JWT_ACCESS_TTL_SECONDS}s`);
  return jwt.sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'], // pinned: never trust the header's alg
    });
    if (!payload.sub || typeof payload.role !== 'string') throw new Error('missing claims');
    return payload as AccessClaims;
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}

/* ------------------------------ refresh tokens ---------------------------- */

export interface IssuedRefresh {
  token: string;
  id: string;
  familyId: string;
  expiresAt: Date;
}

export async function issueRefreshToken(opts: {
  userId: string;
  familyId?: string;
  replacesId?: string;
  ip?: string;
  userAgent?: string;
  /**
   * Auth level of the session this token belongs to. It is a property of the
   * session, not of the account, so it has to travel with the refresh token:
   * re-deriving it at refresh time from users.mfa_enabled would silently
   * elevate a session that never passed a TOTP challenge.
   */
  aal?: 'aal1' | 'mfa';
}): Promise<IssuedRefresh> {
  const db = await getDb();
  const token = randomToken(48);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + env.REFRESH_TTL_SECONDS * 1000);

  const { rows } = await db.query<{ id: string; family_id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip, aal)
     VALUES ($1, $2, COALESCE($3::uuid, gen_random_uuid()), $4, $5, $6, $7)
     RETURNING id, family_id`,
    [
      opts.userId, tokenHash, opts.familyId ?? null, expiresAt,
      opts.userAgent ?? null, opts.ip ?? null, opts.aal ?? 'aal1',
    ],
  );

  if (opts.replacesId) {
    await db.query('UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2', [
      rows[0].id,
      opts.replacesId,
    ]);
  }
  return { token, id: rows[0].id, familyId: rows[0].family_id, expiresAt };
}

export interface RotationResult {
  userId: string;
  refresh: IssuedRefresh;
  /** Carried across rotation so an MFA session stays an MFA session. */
  aal: 'aal1' | 'mfa';
}

/**
 * Rotates a refresh token. If a token that was already rotated is presented
 * again, that is token theft (the legitimate client and the attacker both
 * hold a copy) — the whole family is revoked and the user must sign in again.
 */
export async function rotateRefreshToken(
  presented: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<RotationResult> {
  const db = await getDb();
  const tokenHash = sha256(presented);

  const { rows } = await db.query<{
    id: string;
    user_id: string;
    family_id: string;
    expires_at: string;
    revoked_at: string | null;
    replaced_by: string | null;
    status: string;
    aal: 'aal1' | 'mfa';
  }>(
    `SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at, rt.revoked_at, rt.replaced_by,
            rt.aal, u.status
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1`,
    [tokenHash],
  );

  const row = rows[0];
  if (!row) throw unauthorized('Session not recognised. Please sign in again.');

  if (row.revoked_at || row.replaced_by) {
    await revokeFamily(row.family_id, 'reuse_detected');
    logger.warn({ userId: row.user_id, familyId: row.family_id }, 'refresh token reuse detected');
    throw unauthorized('Session expired for security reasons. Please sign in again.');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  if (row.status !== 'active') {
    throw unauthorized('This account is not active.');
  }

  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'rotated' WHERE id = $1`,
    [row.id],
  );
  const refresh = await issueRefreshToken({
    userId: row.user_id,
    familyId: row.family_id,
    replacesId: row.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    aal: row.aal,
  });
  return { userId: row.user_id, refresh, aal: row.aal };
}

export async function revokeFamily(familyId: string, reason: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, reason],
  );
}

export async function revokeAllForUser(userId: string, reason: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}

export async function revokeByToken(presented: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'logout'
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256(presented)],
  );
}
