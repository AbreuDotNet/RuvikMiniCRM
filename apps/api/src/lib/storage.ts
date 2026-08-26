import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { notFound } from './errors.js';

/**
 * Object storage. Everything is private by default and reachable only through
 * a short-lived signed URL, so a leaked key is not a leaked document.
 */
export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  name: string;
}

/** Blocks traversal (`../`), absolute paths and NUL bytes in storage keys. */
export function assertSafeKey(key: string): string {
  if (!key || key.length > 512) throw notFound('Invalid storage key.');
  if (key.includes('\0') || key.includes('..') || key.startsWith('/') || path.isAbsolute(key)) {
    throw notFound('Invalid storage key.');
  }
  if (!/^[A-Za-z0-9/_.-]+$/.test(key)) throw notFound('Invalid storage key.');
  return key;
}

function createLocalDriver(root: string): StorageDriver {
  const resolveKey = (key: string) => {
    assertSafeKey(key);
    const full = path.resolve(root, key);
    // Defence in depth: the resolved path must stay inside the root.
    if (!full.startsWith(path.resolve(root) + path.sep)) throw notFound('Invalid storage key.');
    return full;
  };

  return {
    name: 'local',
    async put(key, body) {
      const full = resolveKey(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, body, { mode: 0o600 });
    },
    async get(key) {
      try {
        return await fs.readFile(resolveKey(key));
      } catch {
        throw notFound('That file is no longer available.');
      }
    },
    async delete(key) {
      await fs.unlink(resolveKey(key)).catch(() => undefined);
    },
    async exists(key) {
      try {
        await fs.access(resolveKey(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  // The S3 driver plugs in here; the interface above is all it needs to satisfy.
  driver = createLocalDriver(env.STORAGE_DIR);
  return driver;
}

/* ----------------------------- signed URLs -------------------------------- */

/**
 * URL signature covers the key and expiry, so neither can be tampered with
 * and links cannot be shared indefinitely.
 */
export function signStorageUrl(key: string, ttlSeconds = env.STORAGE_SIGNED_URL_TTL_SECONDS): string {
  assertSafeKey(key);
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = crypto
    .createHmac('sha256', env.ENCRYPTION_KEY)
    .update(`${key}:${expires}`)
    .digest('base64url');
  const params = new URLSearchParams({ key, expires: String(expires), sig });
  return `${env.API_BASE_URL}/api/v1/files/download?${params.toString()}`;
}

export function verifyStorageSignature(key: string, expires: string, sig: string): boolean {
  const expiresNum = Number(expires);
  if (!Number.isFinite(expiresNum) || expiresNum < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto
    .createHmac('sha256', env.ENCRYPTION_KEY)
    .update(`${key}:${expiresNum}`)
    .digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Content-addressed key. Grouping by tenant keeps deletion simple. */
export function buildStorageKey(parts: {
  tenant: string;
  kind: string;
  filename: string;
}): string {
  const ext = path.extname(parts.filename).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const rand = crypto.randomBytes(16).toString('hex');
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '/');
  return `${parts.kind}/${parts.tenant}/${yyyymm}/${rand}${ext}`;
}
