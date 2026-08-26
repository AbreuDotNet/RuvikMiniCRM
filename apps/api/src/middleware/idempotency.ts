import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/index.js';
import { sha256 } from '../lib/crypto.js';
import { conflict } from '../lib/errors.js';

/**
 * Idempotency for money-moving endpoints. A client that retries after a
 * timeout replays the original response instead of charging twice.
 *
 * Header: Idempotency-Key: <opaque, client-generated>
 */
export function idempotency(endpoint: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 200) return next();

    try {
      const db = await getDb();
      const scopedKey = `${endpoint}:${req.auth?.userId ?? 'anon'}:${key}`;
      const requestHash = sha256(JSON.stringify(req.body ?? {}));

      const existing = await db.query<{
        request_hash: string;
        response_status: number | null;
        response_body: unknown;
        completed_at: string | null;
      }>('SELECT request_hash, response_status, response_body, completed_at FROM idempotency_keys WHERE key = $1',
        [scopedKey]);

      const row = existing.rows[0];
      if (row) {
        // Same key with different content is a client bug, not a retry.
        if (row.request_hash !== requestHash) {
          return next(conflict('This idempotency key was already used with a different request.'));
        }
        if (row.completed_at && row.response_status) {
          res.setHeader('Idempotent-Replay', 'true');
          return res.status(row.response_status).json(row.response_body);
        }
        // Original request is still in flight.
        return next(conflict('That request is still being processed. Please wait.'));
      }

      await db.query(
        `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash)
         VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
        [scopedKey, req.auth?.userId ?? null, endpoint, requestHash],
      );

      // Capture the response so a later retry can replay it verbatim.
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (res.statusCode < 500) {
          void db.query(
            `UPDATE idempotency_keys SET response_status = $2, response_body = $3, completed_at = now()
              WHERE key = $1`,
            [scopedKey, res.statusCode, JSON.stringify(body)],
          );
        } else {
          void db.query('DELETE FROM idempotency_keys WHERE key = $1', [scopedKey]);
        }
        return originalJson(body);
      }) as Response['json'];

      next();
    } catch (err) {
      next(err);
    }
  };
}
