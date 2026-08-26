import { randomToken } from './crypto.js';
import type { Queryable } from '../db/index.js';

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** URL-safe slug: strips accents, collapses punctuation, caps the length. */
export function slugify(input: string, fallback = 'provider'): string {
  const slug = input
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

/** Produces a slug that is not yet taken in `providers.slug`. */
export async function uniqueProviderSlug(client: Queryable, businessName: string): Promise<string> {
  const base = slugify(businessName);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0
      ? base
      : `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4)}`;
    const { rows } = await client.query('SELECT 1 FROM providers WHERE slug = $1', [candidate]);
    if (!rows.length) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
