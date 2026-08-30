import { describe, it, expect } from 'vitest';
import {
  encodeCursor, decodeCursor, buildPage,
  encodeKeyset, decodeKeyset, keysetOrderBy, keysetWhere, buildKeysetPage,
  type SortColumn,
} from '../../src/lib/pagination.js';
import { AppError } from '../../src/lib/errors.js';

const ID = '3f1c9b7e-1f9a-4d2c-9b3e-8a7c6d5e4f30';

describe('cursor pagination', () => {
  it('round-trips a cursor', () => {
    const cursor = encodeCursor({ createdAt: '2026-08-25T10:00:00.000Z', id: ID });
    expect(decodeCursor(cursor)).toEqual({ createdAt: '2026-08-25T10:00:00.000Z', id: ID });
  });

  it('rejects a cursor that is not valid base64 content', () => {
    expect(() => decodeCursor('!!!not-a-cursor!!!')).toThrow(AppError);
  });

  it('rejects a cursor whose id is not a uuid', () => {
    const forged = Buffer.from('2026-08-25T10:00:00.000Z|1 OR 1=1', 'utf8').toString('base64url');
    expect(() => decodeCursor(forged)).toThrow(AppError);
  });

  it('rejects a cursor with an unparseable timestamp', () => {
    const forged = Buffer.from(`not-a-date|${ID}`, 'utf8').toString('base64url');
    expect(() => decodeCursor(forged)).toThrow(AppError);
  });
});

describe('page building', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    id: `3f1c9b7e-1f9a-4d2c-9b3e-8a7c6d5e4f3${i}`,
    created_at: `2026-08-2${i}T10:00:00.000Z`,
  }));

  it('trims the sentinel row and exposes a next cursor', () => {
    const page = buildPage(rows, 5);
    expect(page.data).toHaveLength(5);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it('reports the end of the list when no sentinel came back', () => {
    const page = buildPage(rows.slice(0, 3), 5);
    expect(page.data).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('handles an empty result', () => {
    const page = buildPage([], 20);
    expect(page).toEqual({ data: [], nextCursor: null, hasMore: false });
  });
});

describe('multi-column keyset', () => {
  const CREATED: SortColumn = { sql: 's.created_at', direction: 'DESC', nulls: 'LAST', type: 'timestamptz' };
  const ROW_ID: SortColumn = { sql: 's.id', direction: 'DESC', nulls: 'LAST', type: 'uuid' };
  const PRICE_ASC: SortColumn = { sql: 's.price_cents', direction: 'ASC', nulls: 'LAST', type: 'int' };

  const binder = () => {
    const params: unknown[] = [];
    return {
      params,
      push: (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      },
    };
  };

  it('emits nulls handling explicitly in the ORDER BY', () => {
    expect(keysetOrderBy([PRICE_ASC, CREATED, ROW_ID])).toBe(
      's.price_cents ASC NULLS LAST, s.created_at DESC NULLS LAST, s.id DESC NULLS LAST',
    );
  });

  it('binds every cursor value instead of interpolating it', () => {
    const b = binder();
    const sql = keysetWhere([CREATED, ROW_ID], ['2026-08-25T10:00:00.000Z', ID], b.push);
    expect(sql).not.toContain('2026-08-25');
    expect(sql).not.toContain(ID);
    expect(b.params).toEqual([
      '2026-08-25T10:00:00.000Z', '2026-08-25T10:00:00.000Z', ID,
    ]);
  });

  it('treats the trailing null block as coming after every value', () => {
    const b = binder();
    const sql = keysetWhere([PRICE_ASC, CREATED, ROW_ID], ['500', '2026-08-25T10:00:00.000Z', ID], b.push);
    expect(sql).toContain('s.price_cents > $1::int OR s.price_cents IS NULL');
  });

  it('stops advancing on a column whose cursor value is already in the null block', () => {
    const b = binder();
    const sql = keysetWhere([PRICE_ASC, CREATED, ROW_ID], [null, '2026-08-25T10:00:00.000Z', ID], b.push);
    // Nothing follows NULL under NULLS LAST, so the tiebreak alone decides.
    expect(sql).toContain('false');
    expect(sql).toContain('s.price_cents IS NULL');
  });

  it('round-trips a keyset cursor including nulls', () => {
    const cols = [PRICE_ASC, CREATED, ROW_ID];
    const raw = encodeKeyset([null, '2026-08-25T10:00:00.000Z', ID]);
    expect(decodeKeyset(raw, cols)).toEqual([null, '2026-08-25T10:00:00.000Z', ID]);
  });

  it('rejects a keyset cursor with the wrong arity', () => {
    expect(() => decodeKeyset(encodeKeyset(['1']), [PRICE_ASC, CREATED, ROW_ID])).toThrow(AppError);
  });

  it('rejects a forged numeric cursor value', () => {
    const forged = encodeKeyset(['1); DROP TABLE services;--', '2026-08-25T10:00:00.000Z', ID]);
    expect(() => decodeKeyset(forged, [PRICE_ASC, CREATED, ROW_ID])).toThrow(AppError);
  });

  it('rejects a forged uuid cursor value', () => {
    const forged = encodeKeyset(['500', '2026-08-25T10:00:00.000Z', 'not-a-uuid']);
    expect(() => decodeKeyset(forged, [PRICE_ASC, CREATED, ROW_ID])).toThrow(AppError);
  });

  it('builds the next cursor from the sort tuple, not from created_at alone', () => {
    const rows = [
      { price_cents: 100, created_at: '2026-08-25T10:00:00.000Z', id: ID },
      { price_cents: null, created_at: '2026-08-24T10:00:00.000Z', id: ID },
    ];
    const page = buildKeysetPage(rows, 1, (r) => [
      r.price_cents === null ? null : String(r.price_cents),
      r.created_at,
      r.id,
    ]);
    expect(page.hasMore).toBe(true);
    expect(decodeKeyset(page.nextCursor!, [PRICE_ASC, CREATED, ROW_ID])).toEqual([
      '100', '2026-08-25T10:00:00.000Z', ID,
    ]);
  });
});
