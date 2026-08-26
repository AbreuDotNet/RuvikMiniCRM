import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './index.js';
import { logger } from '../lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');

export async function runMigrations(): Promise<string[]> {
  const db = await getDb();
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const ran: string[] = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec(sql);
    await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    ran.push(version);
    logger.info({ version }, 'migration applied');
  }
  return ran;
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
