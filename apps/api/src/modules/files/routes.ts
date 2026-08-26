import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate, requireProvider, tenantId } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import { validate, validated, uuidSchema, safeText } from '../../middleware/validate.js';
import { storeFile, acceptedMimeTypes } from './service.js';
import { getStorage, verifyStorageSignature, assertSafeKey } from '../../lib/storage.js';
import { badRequest, notFound, forbidden } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';

export const filesRouter = Router();

/**
 * Downloads are authorised by a signed, expiring URL rather than by session,
 * so a link can be embedded in a WhatsApp message or PDF without exposing a
 * bearer token — and stops working on its own.
 */
filesRouter.get(
  '/download',
  validate(z.object({
    key: z.string().min(1).max(512),
    expires: z.string().regex(/^\d+$/),
    sig: z.string().min(10).max(200),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const { key, expires, sig } = validated<{ key: string; expires: string; sig: string }>(req);
    assertSafeKey(key);
    if (!verifyStorageSignature(key, expires, sig)) {
      throw forbidden('That link is invalid or has expired.');
    }

    const db = await getDb();
    const { rows } = await db.query<{ mime_type: string; scan_status: string; original_name: string | null }>(
      'SELECT mime_type, scan_status, original_name FROM files WHERE storage_key = $1',
      [key],
    );
    const file = rows[0];
    if (!file) throw notFound('That file is no longer available.');
    if (file.scan_status === 'infected') throw forbidden('That file was blocked by our scanner.');

    const body = await getStorage().get(key);
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Length', String(body.length));
    // Never render user content inline in the browser origin.
    res.setHeader('Content-Disposition', `attachment; filename="${sanitiseFilename(file.original_name ?? 'file')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(body);
  }),
);

/**
 * Uploads arrive as a raw body with the media type in Content-Type. The
 * express.raw limit is the first line of defence against oversized payloads.
 */
const rawUpload = express.raw({
  type: acceptedMimeTypes(),
  limit: '8mb',
});

filesRouter.post(
  '/uploads',
  authenticate,
  requireProvider,
  limiters.upload,
  rawUpload,
  validate(z.object({
    kind: z.enum(['image', 'logo', 'document']).default('image'),
    filename: safeText(200).optional(),
    caption: safeText(200).optional(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest('Send the file as the raw request body with a supported Content-Type.');
    }
    const { kind, filename, caption } = validated<{ kind: any; filename?: string; caption?: string }>(req);
    const providerId = tenantId(req);

    const stored = await storeFile({
      buffer: req.body,
      declaredMime: String(req.headers['content-type'] ?? '').split(';')[0].trim(),
      originalName: filename,
      ownerUserId: req.auth!.userId,
      providerId,
      kind,
    });

    const db = await getDb();
    if (kind === 'logo') {
      await db.query('UPDATE providers SET logo_file_id = $2, updated_at = now() WHERE id = $1', [
        providerId, stored.id,
      ]);
    } else if (kind === 'image') {
      await db.query(
        `INSERT INTO provider_portfolio_images (provider_id, file_id, caption, sort_order)
         VALUES ($1,$2,$3, COALESCE((SELECT max(sort_order)+1 FROM provider_portfolio_images
                                      WHERE provider_id = $1), 0))`,
        [providerId, stored.id, caption ?? null],
      );
    }

    await writeAudit({
      actorUserId: req.auth!.userId, actorRole: 'provider', action: 'file.uploaded',
      entityType: 'file', entityId: stored.id,
      metadata: { kind, sizeBytes: stored.sizeBytes, mime: stored.mime },
    });

    res.status(201).json({
      id: stored.id,
      mime: stored.mime,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      scanStatus: 'pending',
      message: 'Upload received. It will appear once our scan completes.',
    });
  }),
);

filesRouter.delete(
  '/portfolio/:id',
  authenticate,
  requireProvider,
  limiters.write,
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const { rowCount } = await db.query(
      'DELETE FROM provider_portfolio_images WHERE id = $1 AND provider_id = $2',
      [req.params.id, tenantId(req)],
    );
    if (!rowCount) throw notFound('That image was not found.');
    res.status(204).end();
  }),
);

function sanitiseFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'file';
}
