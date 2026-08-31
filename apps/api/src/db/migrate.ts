import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './index.js';
import { logger } from '../lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');

/**
 * Arbitrary but fixed: every process that migrates this database must use the
 * same key for the lock to mean anything.
 */
const MIGRATION_LOCK_KEY = 0x7275_7669; // "ruvi"

/**
 * Applies pending migrations under an advisory lock.
 *
 * The API and the worker both call this at boot, and docker compose starts
 * them together as soon as Postgres reports healthy. Without the lock they
 * raced on an empty schema_migrations, both ran 001_init, and the loser died
 * with a duplicate-key error from the Postgres catalogue — so `docker compose
 * up` left the stack with no API.
 *
 * The lock is transaction-scoped, which matters twice over: it binds to this
 * transaction's connection rather than to whichever one a pool hands out next,
 * and it is released on commit *or* rollback, so a failed migration cannot
 * leave the lock held and block every future boot.
 */
export async function runMigrations(): Promise<string[]> {
  const db = await getDb();

  return db.tx(async (client) => {
    // Waits here if another process is already migrating; by the time it
    // returns, that process has committed and its work is visible below.
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    const ran: string[] = [];

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.exec(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      ran.push(version);
      logger.info({ version }, 'migration applied');
    }
    return ran;
  });
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntrypoint) {
  runMigrations()
    .then((ran) => {
      // eslint-disable-next-line no-console
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database already up to date.');
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
