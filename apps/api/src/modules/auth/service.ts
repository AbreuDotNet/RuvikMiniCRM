import { authenticator } from 'otplib';
import { getDb } from '../../db/index.js';
import { hashPassword, verifyPassword, encrypt, decrypt, randomToken, sha256 } from '../../lib/crypto.js';
import { conflict, forbidden, unauthorized, badRequest, notFound } from '../../lib/errors.js';
import { signAccessToken, issueRefreshToken, revokeAllForUser, type Role } from '../../lib/tokens.js';
import { writeAudit } from '../../lib/audit.js';
import { enqueue } from '../../lib/queue.js';
import { logger } from '../../lib/logger.js';
import { uniqueProviderSlug } from '../../lib/slug.js';

/** Account lockout: 8 failures inside the window locks for 15 minutes. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

export interface AuthedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  phone: string | null;
  mfaEnabled: boolean;
  whatsappOptIn: boolean;
  providerId?: string | null;
  providerStatus?: string | null;
  subscriptionStatus?: string | null;
}

export async function loadPublicUser(userId: string): Promise<PublicUser> {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT u.id, u.email, u.role, u.full_name, u.phone_e164, u.mfa_enabled, u.whatsapp_opt_in,
            p.id AS provider_id, p.verification_status,
            s.status AS subscription_status
       FROM users u
       LEFT JOIN providers p ON p.user_id = u.id
       LEFT JOIN subscriptions s ON s.provider_id = p.id
            AND s.status IN ('pending_payment','trialing','active','past_due')
      WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw notFound('Account not found.');
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    fullName: r.full_name,
    phone: r.phone_e164,
    mfaEnabled: r.mfa_enabled,
    whatsappOptIn: r.whatsapp_opt_in,
    providerId: r.provider_id ?? null,
    providerStatus: r.verification_status ?? null,
    subscriptionStatus: r.subscription_status ?? null,
  };
}

async function startSession(userId: string, role: Role, ctx: RequestContext, aal: 'aal1' | 'mfa') {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>('SELECT id FROM providers WHERE user_id = $1', [userId]);
  const accessToken = await signAccessToken({
    userId,
    role,
    providerId: rows[0]?.id ?? null,
    aal,
  });
  const refresh = await issueRefreshToken({ userId, ip: ctx.ip, userAgent: ctx.userAgent, aal });
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  return { accessToken, refreshToken: refresh.token };
}

/* --------------------------------- signup -------------------------------- */

export interface SignupInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  role: 'customer' | 'provider';
  businessName?: string;
  city?: string;
}

export async function signup(input: SignupInput, ctx: RequestContext): Promise<AuthedSession> {
  const db = await getDb();

  const existing = await db.query('SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [
    input.email,
  ]);
  if (existing.rows.length) {
    // Registration is a public endpoint; a distinct error here would let an
    // attacker enumerate which emails hold accounts.
    throw conflict('If that email is available you will be able to sign in shortly.');
  }

  if (input.role === 'provider' && !input.businessName) {
    throw badRequest('A business name is required for provider accounts.');
  }

  const passwordHash = await hashPassword(input.password);

  const userId = await db.tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, full_name, phone_e164)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.email, passwordHash, input.role, input.fullName, input.phone ?? null],
    );
    const id = rows[0].id;

    if (input.role === 'provider') {
      // Slugs must be unique platform-wide; a suffix is added on collision.
      const slug = await uniqueProviderSlug(c, input.businessName!);

      await c.query(
        `INSERT INTO providers (user_id, business_name, slug, city, phone_e164)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, input.businessName, slug, input.city ?? null, input.phone ?? null],
      );
    } else {
      await c.query('INSERT INTO customer_profiles (user_id, city) VALUES ($1,$2)', [
        id,
        input.city ?? null,
      ]);
    }
    return id;
  });

  await writeAudit({
    actorUserId: userId,
    actorRole: input.role,
    action: 'auth.signup',
    entityType: 'user',
    entityId: userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { role: input.role },
  });

  await enqueue('email.send', { template: 'welcome', userId });

  const session = await startSession(userId, input.role, ctx, 'aal1');
  return { ...session, expiresIn: 900, user: await loadPublicUser(userId) };
}

/* --------------------------------- login --------------------------------- */

export interface LoginResult {
  status: 'ok' | 'mfa_required';
  session?: AuthedSession;
  mfaToken?: string;
}

export async function login(
  email: string,
  password: string,
  ctx: RequestContext,
): Promise<LoginResult> {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT id, email, role, password_hash, status, mfa_enabled, mfa_secret_enc,
            failed_login_count, locked_until, deleted_at
       FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  const user = rows[0];

  // Uniform failure message + a real hash comparison on the miss path, so
  // response time and content do not reveal whether the account exists.
  const genericFailure = unauthorized('Email or password is incorrect.');

  if (!user || user.deleted_at) {
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Zm9vYmFyYmF6cXV4Y29ycmVjdGhvcnNlYmF0dGVyeQ',
      password,
    ).catch(() => false);
    throw genericFailure;
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw forbidden('Too many failed attempts. Try again in a few minutes.');
  }
  if (user.status === 'suspended') throw forbidden('This account has been suspended.');
  if (user.status !== 'active') throw forbidden('This account is not active.');

  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    const nextCount = user.failed_login_count + 1;
    const lock = nextCount >= MAX_FAILED_LOGINS;
    await db.query(
      `UPDATE users SET failed_login_count = $2,
              locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END
        WHERE id = $1`,
      [user.id, lock ? 0 : nextCount, lock, String(LOCKOUT_MINUTES)],
    );
    await writeAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: lock ? 'auth.login_locked' : 'auth.login_failed',
      entityType: 'user',
      entityId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { attempt: nextCount },
    });
    throw genericFailure;
  }

  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);

  if (user.mfa_enabled) {
    // Short-lived, single-purpose ticket. It is not an access token: it
    // cannot be used against any resource endpoint.
    const mfaToken = randomToken(32);
    await db.query(
      `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash)
       VALUES ($1,$2,'mfa_challenge',$3)`,
      [`mfa:${sha256(mfaToken)}`, user.id, sha256(String(Date.now()))],
    );
    await writeAudit({
      actorUserId: user.id, actorRole: user.role, action: 'auth.mfa_challenge',
      entityType: 'user', entityId: user.id, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { status: 'mfa_required', mfaToken };
  }

  await writeAudit({
    actorUserId: user.id, actorRole: user.role, action: 'auth.login',
    entityType: 'user', entityId: user.id, ip: ctx.ip, userAgent: ctx.userAgent,
  });

  const session = await startSession(user.id, user.role, ctx, 'aal1');
  return { status: 'ok', session: { ...session, expiresIn: 900, user: await loadPublicUser(user.id) } };
}

/* ----------------------------------- MFA ---------------------------------- */

const MFA_TICKET_TTL_MS = 5 * 60 * 1000;

export async function verifyMfa(
  mfaToken: string,
  code: string,
  ctx: RequestContext,
): Promise<AuthedSession> {
  const db = await getDb();
  const key = `mfa:${sha256(mfaToken)}`;
  const { rows } = await db.query<any>(
    `SELECT k.user_id, k.created_at, u.role, u.mfa_secret_enc, u.mfa_recovery_codes, u.status
       FROM idempotency_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key = $1 AND k.endpoint = 'mfa_challenge'`,
    [key],
  );
  const ticket = rows[0];
  if (!ticket) throw unauthorized('That verification session is no longer valid.');
  if (Date.now() - new Date(ticket.created_at).getTime() > MFA_TICKET_TTL_MS) {
    await db.query('DELETE FROM idempotency_keys WHERE key = $1', [key]);
    throw unauthorized('That verification session expired. Please sign in again.');
  }
  if (ticket.status !== 'active') throw forbidden('This account is not active.');

  const secret = decrypt(ticket.mfa_secret_enc);
  let ok = authenticator.verify({ token: code, secret });

  // Recovery codes are single-use and stored hashed.
  if (!ok) {
    const codes: string[] = ticket.mfa_recovery_codes ?? [];
    const codeHash = sha256(code.trim().toUpperCase());
    if (codes.includes(codeHash)) {
      ok = true;
      await db.query('UPDATE users SET mfa_recovery_codes = $2 WHERE id = $1', [
        ticket.user_id,
        JSON.stringify(codes.filter((c) => c !== codeHash)),
      ]);
      logger.warn({ userId: ticket.user_id }, 'MFA recovery code consumed');
    }
  }

  // The ticket is burned whether or not the code was right, so it cannot be
  // used to brute-force TOTP.
  await db.query('DELETE FROM idempotency_keys WHERE key = $1', [key]);

  if (!ok) {
    await writeAudit({
      actorUserId: ticket.user_id, actorRole: ticket.role, action: 'auth.mfa_failed',
      entityType: 'user', entityId: ticket.user_id, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    throw unauthorized('That code is not valid. Please try again.');
  }

  await writeAudit({
    actorUserId: ticket.user_id, actorRole: ticket.role, action: 'auth.login_mfa',
    entityType: 'user', entityId: ticket.user_id, ip: ctx.ip, userAgent: ctx.userAgent,
  });

  const session = await startSession(ticket.user_id, ticket.role, ctx, 'mfa');
  return { ...session, expiresIn: 900, user: await loadPublicUser(ticket.user_id) };
}

export async function beginMfaEnrollment(userId: string, email: string) {
  const db = await getDb();
  const secret = authenticator.generateSecret();
  await db.query('UPDATE users SET mfa_secret_enc = $2 WHERE id = $1', [userId, encrypt(secret)]);
  return {
    secret,
    otpauthUrl: authenticator.keyuri(email, 'Ruvik', secret),
  };
}

export async function confirmMfaEnrollment(userId: string, code: string, ctx: RequestContext) {
  const db = await getDb();
  const { rows } = await db.query<{ mfa_secret_enc: string | null; role: Role }>(
    'SELECT mfa_secret_enc, role FROM users WHERE id = $1',
    [userId],
  );
  const enc = rows[0]?.mfa_secret_enc;
  if (!enc) throw badRequest('Start two-factor setup first.');

  if (!authenticator.verify({ token: code, secret: decrypt(enc) })) {
    throw badRequest('That code is not valid. Check your authenticator app and try again.');
  }

  const recoveryCodes = Array.from({ length: 8 }, () =>
    randomToken(5).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8),
  );
  await db.query('UPDATE users SET mfa_enabled = true, mfa_recovery_codes = $2 WHERE id = $1', [
    userId,
    JSON.stringify(recoveryCodes.map((c) => sha256(c))),
  ]);

  await writeAudit({
    actorUserId: userId, actorRole: rows[0].role, action: 'auth.mfa_enabled',
    entityType: 'user', entityId: userId, ip: ctx.ip, userAgent: ctx.userAgent,
  });

  // Shown once, never retrievable again.
  return { recoveryCodes };
}

export async function disableMfa(userId: string, password: string, ctx: RequestContext) {
  const db = await getDb();
  const { rows } = await db.query<{ password_hash: string; role: Role }>(
    'SELECT password_hash, role FROM users WHERE id = $1',
    [userId],
  );
  if (!rows[0] || !(await verifyPassword(rows[0].password_hash, password))) {
    throw unauthorized('Password is incorrect.');
  }
  await db.query(
    `UPDATE users SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_recovery_codes = '[]'::jsonb
      WHERE id = $1`,
    [userId],
  );
  await writeAudit({
    actorUserId: userId, actorRole: rows[0].role, action: 'auth.mfa_disabled',
    entityType: 'user', entityId: userId, ip: ctx.ip, userAgent: ctx.userAgent,
  });
}

/* ----------------------------- password reset ----------------------------- */

const RESET_TTL_MINUTES = 30;

export async function requestPasswordReset(email: string, ctx: RequestContext): Promise<void> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL AND status = \'active\'',
    [email],
  );
  // Always returns success to the caller — see the route. Only the presence
  // of an account decides whether an email is actually queued.
  if (!rows[0]) return;

  const token = randomToken(32);
  await db.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [rows[0].id, sha256(token), String(RESET_TTL_MINUTES)],
  );
  await enqueue('email.send', { template: 'password_reset', userId: rows[0].id, token });
  await writeAudit({
    actorUserId: rows[0].id, action: 'auth.password_reset_requested',
    entityType: 'user', entityId: rows[0].id, ip: ctx.ip, userAgent: ctx.userAgent,
  });
}

export async function resetPassword(token: string, newPassword: string, ctx: RequestContext): Promise<void> {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.role
       FROM password_resets pr JOIN users u ON u.id = pr.user_id
      WHERE pr.token_hash = $1`,
    [sha256(token)],
  );
  const reset = rows[0];
  if (!reset || reset.used_at || new Date(reset.expires_at).getTime() < Date.now()) {
    throw badRequest('That reset link is invalid or has expired.');
  }

  const passwordHash = await hashPassword(newPassword);
  await db.tx(async (c) => {
    await c.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]);
    await c.query(
      'UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1',
      [reset.user_id, passwordHash],
    );
  });

  // A password change invalidates every existing session.
  await revokeAllForUser(reset.user_id, 'password_reset');

  await writeAudit({
    actorUserId: reset.user_id, actorRole: reset.role, action: 'auth.password_reset',
    entityType: 'user', entityId: reset.user_id, ip: ctx.ip, userAgent: ctx.userAgent,
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  ctx: RequestContext,
): Promise<void> {
  const db = await getDb();
  const { rows } = await db.query<{ password_hash: string; role: Role }>(
    'SELECT password_hash, role FROM users WHERE id = $1',
    [userId],
  );
  if (!rows[0] || !(await verifyPassword(rows[0].password_hash, currentPassword))) {
    throw unauthorized('Your current password is incorrect.');
  }
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    userId,
    await hashPassword(newPassword),
  ]);
  await revokeAllForUser(userId, 'password_changed');
  await writeAudit({
    actorUserId: userId, actorRole: rows[0].role, action: 'auth.password_changed',
    entityType: 'user', entityId: userId, ip: ctx.ip, userAgent: ctx.userAgent,
  });
}
