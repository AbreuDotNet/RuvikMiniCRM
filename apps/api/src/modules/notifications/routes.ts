import { Router } from 'express';
import { z } from 'zod';
import { booleanish } from '../../lib/zodBoolean.js';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { validate, validated, uuidSchema } from '../../middleware/validate.js';
import { paginationSchema, decodeCursor, buildPage } from '../../lib/pagination.js';
import { notFound } from '../../lib/errors.js';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  validate(paginationSchema.extend({ unreadOnly: booleanish.optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { limit, cursor, unreadOnly } = validated<{ limit: number; cursor?: string; unreadOnly?: boolean }>(req);
    const params: unknown[] = [req.auth!.userId];
    const where = ['user_id = $1'];
    if (unreadOnly) where.push('read_at IS NULL');
    if (cursor) {
      const cur = decodeCursor(cursor);
      params.push(cur.createdAt, cur.id);
      where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(limit + 1);

    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT id, type, title, body, data, read_at, created_at
         FROM notifications WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    const unread = await db.query<{ count: string }>(
      'SELECT count(*)::text FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [req.auth!.userId],
    );

    const page = buildPage(rows, limit);
    res.json({
      data: page.data.map((n) => ({
        id: n.id, type: n.type, title: n.title, body: n.body,
        data: n.data, readAt: n.read_at, createdAt: n.created_at,
      })),
      unreadCount: Number(unread.rows[0].count),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit },
    });
  }),
);

notificationsRouter.post(
  '/:id/read',
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rowCount } = await db.query(
      'UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
      [req.params.id, req.auth!.userId],
    );
    if (!rowCount) {
      const exists = await db.query('SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2', [
        req.params.id, req.auth!.userId,
      ]);
      if (!exists.rows.length) throw notFound('Notification not found.');
    }
    res.json({ message: 'Marked as read.' });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rowCount } = await db.query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [req.auth!.userId],
    );
    res.json({ marked: rowCount });
  }),
);
