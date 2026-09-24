import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { booleanish } from '../lib/zodBoolean.js';
import crypto from 'node:crypto';

/**
 * Loads a .env into process.env, which .env.example has always documented but
 * nothing actually read — so every value in it was silently ignored.
 *
 * Uses Node's own loader rather than a dependency, and it does not overwrite
 * anything already set: the real environment wins, the file only fills gaps.
 * That keeps `FOO=bar npm start` working and keeps production, where secrets
 * arrive from a secrets manager, unaffected by a stray file on disk.
 *
 * The file lives at the repository root while the API usually runs from
 * apps/api, so the lookup walks up a few levels from the working directory.
 */
function loadDotEnv(): void {
  if (typeof process.loadEnvFile !== 'function') return;

  let dir = process.cwd();
  for (let depth = 0; depth < 4; depth++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // Unreadable or malformed: the real environment still applies, and
        // the schema below reports anything genuinely missing.
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadDotEnv();

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

  /**
   * Push notifications, through Expo.
   *
   * Default **true**, unlike WhatsApp: Expo push needs no account and no
   * credentials, so there is nothing to set up and defaulting to off would
   * only reproduce the gap this replaced — a device token obtained on every
   * launch and thrown away. Set it false to run the whole path in simulation.
   */
  PUSH_ENABLED: booleanish.default(true),
  /**
   * Only needed by projects that have turned on Expo's enhanced security for
   * push. Absent, sends are unauthenticated, which is Expo's default.
   */
  EXPO_ACCESS_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),

  /**
   * Stripe. All optional: the integration in modules/billing/stripe sits in
   * the repository unconfigured, reports that it is not set up, and the manual
   * billing flow keeps working. Nothing here is required to boot.
   */
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  /** The signing secret of the webhook endpoint, not the API key. */
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),

  // Liveness for the standalone worker process (`npm run worker`).
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  /**
   * How long the poll loop may go without progress before the probe reports a
   * stall. Generous on purpose: the loop ticks every second, so anything this
   * large means genuinely wedged, and an over-eager threshold would kill
   * healthy workers in the middle of a slow job.
   */
  WORKER_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(60_000),

  /**
   * Whether the admin routes that change state demand a two-factor session.
   *
   * True everywhere by default, and the boot below refuses to start if
   * anything tries to set it false in production. It exists so a local or demo
   * deployment can exercise the admin panel without enrolling a second factor;
   * it is not a setting, it is a development affordance with a guard rail.
   */
  ADMIN_MFA_REQUIRED: booleanish.default(true),

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

// Loud rather than silently corrected: a deployment that believes it turned
// this off should be told it did not, at boot, instead of discovering months
// later that the guard was never on — or that it was.
if (isProd && raw.ADMIN_MFA_REQUIRED === false) {
  // eslint-disable-next-line no-console
  console.error(
    'FATAL: ADMIN_MFA_REQUIRED=false is refused in production. Two-factor gates the '
    + 'routes that suspend, block and verify accounts; a stolen admin password must '
    + 'not be enough to use them.',
  );
  process.exit(1);
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
