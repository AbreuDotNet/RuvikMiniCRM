import { z } from 'zod';
import { badRequest } from './errors.js';

/**
 * Cursor pagination keyed on (created_at, id). Offset pagination degrades
 * badly past a few thousand rows, and these lists are unbounded.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt}|${c.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw badRequest('Invalid pagination cursor.');
  }
  const sep = decoded.lastIndexOf('|');
  if (sep === -1) throw badRequest('Invalid pagination cursor.');
  const createdAt = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!createdAt || !/^[0-9a-f-]{36}$/i.test(id)) throw badRequest('Invalid pagination cursor.');
  if (Number.isNaN(Date.parse(createdAt))) throw badRequest('Invalid pagination cursor.');
  return { createdAt, id };
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Call with limit+1 rows fetched; trims the sentinel row and derives the cursor.
 */
export function buildPage<T extends { id: string; created_at: string | Date }>(
  rows: T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          createdAt: last.created_at instanceof Date ? last.created_at.toISOString() : String(last.created_at),
          id: last.id,
        })
      : null;
  return { data, nextCursor, hasMore };
}
