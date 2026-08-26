import crypto from 'node:crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { env } from '../config/env.js';

/**
 * Argon2id parameters. OWASP Password Storage Cheat Sheet minimum:
 * m=19456 KiB (19 MiB), t=2, p=1.
 */
const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON_OPTS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hashed, plain, ARGON_OPTS);
  } catch {
    return false; // malformed hash must never throw an auth path open
  }
}

/** Cryptographically random, URL-safe opaque token. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Deterministic hash for storing lookup keys (refresh tokens, share links). */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Keyed hash — used where a value is PII and must not be reversible from the DB. */
export function hmac(input: string, key = env.HASH_PEPPER): string {
  return crypto.createHmac('sha256', key).update(input).digest('hex');
}

/** Constant-time string compare that tolerates differing lengths. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still burn a comparison so the failure cost is uniform.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/* ------------------------------- at-rest encryption ----------------------- */
const KEY = crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest(); // 32 bytes

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('malformed ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}
