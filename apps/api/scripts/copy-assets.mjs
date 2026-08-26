/**
 * tsc emits JavaScript only, so the SQL migrations that live beside the
 * source would be missing from dist and the compiled server would fail at
 * its first migration. Copy them alongside the build output.
 */
import { cpSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'src', 'db', 'migrations');
const to = path.join(root, 'dist', 'db', 'migrations');

if (!existsSync(from)) {
  console.error(`No migrations directory at ${from}`);
  process.exit(1);
}

cpSync(from, to, { recursive: true });

const copied = readdirSync(to).filter((f) => f.endsWith('.sql'));
if (copied.length === 0) {
  console.error('No .sql files were copied — the build would fail at runtime.');
  process.exit(1);
}
console.log(`Copied ${copied.length} migration(s) to dist/db/migrations`);
