import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = any>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  /** Runs a multi-statement SQL script (migrations, seeds). No parameters. */
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  /** Runs fn inside a transaction; rolls back on any throw. */
  tx<T>(fn: (client: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  driver: 'pg' | 'pglite';
}

/* -------------------------------------------------------------------------- */
/* node-postgres driver (production)                                          */
/* -------------------------------------------------------------------------- */
async function createPgDatabase(url: string): Promise<Database> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    ssl: url.includes('sslmode=disable') ? false : undefined,
  });
  pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));

  return {
    driver: 'pg',
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await pool.query(sql, params as unknown[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async tx<T>(fn: (c: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const wrapped: Queryable = {
          async query<R>(sql: string, params: readonly unknown[] = []) {
            const res = await client.query(sql, params as unknown[]);
            return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
          },
          async exec(sql: string) {
            await client.query(sql);
          },
        };
        const out = await fn(wrapped);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* PGlite driver (embedded PostgreSQL for local dev, CI and tests)            */
/* -------------------------------------------------------------------------- */
async function createPgliteDatabase(): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  // In-memory for tests so every run starts from a clean slate.
  const dataDir = env.isTest ? undefined : env.PGLITE_DIR;
  if (dataDir) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
  }
  const pglite = new PGlite(dataDir);
  await pglite.waitReady;

  // PGlite is single-connection: serialise access so concurrent requests and
  // transactions cannot interleave statements on the same wire.
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const rawQuery = async <T>(sql: string, params: readonly unknown[] = []) => {
    const res = await pglite.query(sql, params as unknown[]);
    return { rows: (res.rows ?? []) as T[], rowCount: res.affectedRows ?? res.rows?.length ?? 0 };
  };

  return {
    driver: 'pglite',
    query<T>(sql: string, params: readonly unknown[] = []) {
      return serialize(() => rawQuery<T>(sql, params));
    },
    exec(sql: string) {
      return serialize(async () => {
        await pglite.exec(sql);
      });
    },
    tx<T>(fn: (c: Queryable) => Promise<T>) {
      return serialize(async () => {
        await rawQuery('BEGIN');
        try {
          const inner: Queryable = {
            query: (sql, params) => rawQuery(sql, params),
            exec: async (script: string) => {
              await pglite.exec(script);
            },
          };
          const out = await fn(inner);
          await rawQuery('COMMIT');
          return out;
        } catch (err) {
          await rawQuery('ROLLBACK').catch(() => undefined);
          throw err;
        }
      });
    },
    async close() {
      await pglite.close();
    },
  };
}

let instance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (instance) return instance;
  instance = env.DATABASE_URL
    ? await createPgDatabase(env.DATABASE_URL)
    : await createPgliteDatabase();
  logger.info({ driver: instance.driver }, 'database ready');
  return instance;
}

/** Test helper — drops the memoised handle so a fresh in-memory DB is created. */
export async function resetDb(): Promise<void> {
  if (instance) await instance.close().catch(() => undefined);
  instance = null;
}

/** Convenience for call sites that only need a one-off query. */
export async function query<T = any>(sql: string, params: readonly unknown[] = []) {
  const db = await getDb();
  return db.query<T>(sql, params);
}

/** Convenience for one-off multi-statement scripts. */
export async function exec(sql: string) {
  const db = await getDb();
  return db.exec(sql);
}
