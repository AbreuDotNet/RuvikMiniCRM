import { z } from 'zod';
import { booleanish } from '../lib/zodBoolean.js';
import crypto from 'node:crypto';

/**
 * Configuration is validated once at boot. A missing or weak secret in
 * production is a hard failure, never a silent default.
 */
const isProd = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_BASE_URL: z.string().url().default('http://localhost:5173'),

  // Empty string -> undefined, so an unset var does not fail .url()
  DATABASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  PGLITE_DIR: z.string().default('.data/pglite'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().default(15_000),

  REDIS_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),

  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().default(900),            // 15 min
  REFRESH_TTL_SECONDS: z.coerce.number().int().default(60 * 60 * 24 * 30), // 30 days
  ENCRYPTION_KEY: z.string().min(32).optional(),   // at-rest encryption (MFA secrets)
  HASH_PEPPER: z.string().min(16).optional(),      // HMAC pepper for phone hashes

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('storage'),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().default(300),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),

  MAX_UPLOAD_BYTES: z.coerce.number().int().default(8 * 1024 * 1024),
  MAX_JSON_BYTES: z.coerce.number().int().default(256 * 1024),

  WHATSAPP_ENABLED: booleanish.default(false),
  WHATSAPP_API_BASE: z.string().default('https://graph.facebook.com/v21.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  BILLING_WEBHOOK_SECRET: z.string().optional(),

  RATE_LIMIT_ENABLED: booleanish.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: z.coerce.number().int().default(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

/** Dev/test convenience: deterministic-per-boot secrets so nothing ships insecurely by default. */
function requireSecret(name: string, value: string | undefined, bytes = 32): string {
  if (value) return value;
  if (isProd) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: ${name} must be set in production (load it from a secrets manager).`);
    process.exit(1);
  }
  return crypto.randomBytes(bytes).toString('hex');
}

export const env = {
  ...raw,
  isProd,
  isTest: raw.NODE_ENV === 'test',
  JWT_ACCESS_SECRET: requireSecret('JWT_ACCESS_SECRET', raw.JWT_ACCESS_SECRET),
  ENCRYPTION_KEY: requireSecret('ENCRYPTION_KEY', raw.ENCRYPTION_KEY),
  HASH_PEPPER: requireSecret('HASH_PEPPER', raw.HASH_PEPPER, 16),
  BILLING_WEBHOOK_SECRET: requireSecret('BILLING_WEBHOOK_SECRET', raw.BILLING_WEBHOOK_SECRET),
};

export type Env = typeof env;
