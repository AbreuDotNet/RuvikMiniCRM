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

/* ==========================================================================
   Multi-column keyset pagination

   The helpers above assume the list is ordered by (created_at, id). A list
   sorted by anything else — price, rating, search rank — needs a cursor that
   carries the whole ORDER BY tuple, otherwise the `<` comparison is against
   columns the rows are not ordered by and pages silently skip and repeat
   rows. These build the ORDER BY and the matching predicate from one spec so
   the two cannot drift apart.
   ========================================================================== */

export type SortDirection = 'ASC' | 'DESC';

export interface SortColumn {
  /** SQL expression to order by, e.g. 's.price_cents'. Must be side-effect free. */
  sql: string;
  direction: SortDirection;
  /** Explicit, because Postgres defaults differ per direction. */
  nulls: 'FIRST' | 'LAST';
  /** Cast applied to the bound cursor value, e.g. 'int', 'timestamptz'. */
  type: 'int' | 'numeric' | 'float8' | 'timestamptz' | 'uuid' | 'text';
}

const VALUE_PATTERNS: Record<SortColumn['type'], RegExp | null> = {
  int: /^-?\d{1,19}$/,
  numeric: /^-?\d{1,20}(\.\d{1,10})?$/,
  float8: /^-?\d{1,20}(\.\d{1,20})?([eE][-+]?\d{1,3})?$/,
  timestamptz: null,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  text: null,
};

export function keysetOrderBy(columns: SortColumn[]): string {
  return columns.map((c) => `${c.sql} ${c.direction} NULLS ${c.nulls}`).join(', ');
}

/**
 * Predicate selecting rows strictly after `values` in `columns` order. Built
 * lexicographically: a row qualifies if it is past the cursor on the first
 * column, or ties there and qualifies on the rest.
 *
 * `push` binds a value and returns its placeholder, so nothing is interpolated.
 */
export function keysetWhere(
  columns: SortColumn[],
  values: Array<string | null>,
  push: (value: unknown) => string,
): string {
  if (columns.length !== values.length) {
    throw new Error('keysetWhere: column/value length mismatch');
  }

  const build = (i: number): string => {
    if (i >= columns.length) return 'false';
    const col = columns[i]!;
    const raw = values[i]!;

    // A NULL sorts in one block; whether anything follows it on this column
    // depends on which end the nulls were placed.
    const after =
      raw === null
        ? col.nulls === 'FIRST'
          ? `${col.sql} IS NOT NULL`
          : 'false'
        : (() => {
            const p = `${push(raw)}::${col.type}`;
            const cmp = col.direction === 'ASC' ? '>' : '<';
            // With NULLS LAST the null block trails every non-null value, so
            // it is also "after" the cursor.
            return col.nulls === 'LAST'
              ? `(${col.sql} ${cmp} ${p} OR ${col.sql} IS NULL)`
              : `${col.sql} ${cmp} ${p}`;
          })();

    // The last column has no tie left to break, so it must not bind an
    // equality value: that placeholder would never appear in the SQL, and
    // Postgres rejects a bind supplying more parameters than the statement
    // references.
    if (i + 1 >= columns.length) return after;

    const eq = raw === null ? `${col.sql} IS NULL` : `${col.sql} = ${push(raw)}::${col.type}`;
    return `${after} OR (${eq} AND (${build(i + 1)}))`;
  };

  return `(${build(0)})`;
}

export function encodeKeyset(values: Array<string | null>): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

export function decodeKeyset(raw: string, columns: SortColumn[]): Array<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('Invalid pagination cursor.');
  }
  if (!Array.isArray(parsed) || parsed.length !== columns.length) {
    throw badRequest('Invalid pagination cursor.');
  }
  return parsed.map((value, i) => {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > 64) throw badRequest('Invalid pagination cursor.');
    const col = columns[i]!;
    if (col.type === 'timestamptz') {
      if (Number.isNaN(Date.parse(value))) throw badRequest('Invalid pagination cursor.');
      return value;
    }
    const pattern = VALUE_PATTERNS[col.type];
    if (pattern && !pattern.test(value)) throw badRequest('Invalid pagination cursor.');
    return value;
  });
}

/** buildPage for a multi-column keyset; `extract` reads the sort tuple off a row. */
export function buildKeysetPage<T>(
  rows: T[],
  limit: number,
  extract: (row: T) => Array<string | null>,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    nextCursor: hasMore && last ? encodeKeyset(extract(last)) : null,
    hasMore,
  };
}
