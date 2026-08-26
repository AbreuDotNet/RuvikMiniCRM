import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, buildPage } from '../../src/lib/pagination.js';
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
