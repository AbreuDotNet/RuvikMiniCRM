import crypto from 'node:crypto';
import { getDb } from '../../db/index.js';
import { getStorage, buildStorageKey } from '../../lib/storage.js';
import { unsupportedMedia, tooLarge, badRequest } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { enqueue } from '../../lib/queue.js';

/**
 * Allow-list of accepted uploads. The declared Content-Type is never trusted
 * on its own — the file's magic bytes must agree, which is what stops a
 * polyglot or a renamed script from being stored as an "image".
 */
const SIGNATURES: Array<{
  mime: string;
  ext: string;
  test: (b: Buffer) => boolean;
}> = [
  {
    mime: 'image/jpeg',
    ext: '.jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: '.png',
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    ext: '.webp',
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'application/pdf',
    ext: '.pdf',
    test: (b) => b.length > 4 && b.subarray(0, 5).toString('ascii') === '%PDF-',
  },
];

export interface StoreFileInput {
  buffer: Buffer;
  declaredMime: string;
  originalName?: string;
  ownerUserId: string;
  providerId?: string | null;
  kind: 'image' | 'document' | 'logo' | 'avatar' | 'quote_pdf' | 'invoice_pdf';
  visibility?: 'private' | 'public';
  /** Skips the content sniff for artefacts the platform generated itself. */
  trusted?: boolean;
}

export interface StoredFile {
  id: string;
  storageKey: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

export async function storeFile(input: StoreFileInput): Promise<StoredFile> {
  const { buffer } = input;
  if (buffer.length === 0) throw badRequest('The uploaded file is empty.');
  if (buffer.length > env.MAX_UPLOAD_BYTES) {
    throw tooLarge(`Files must be ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB or smaller.`);
  }

  let mime = input.declaredMime;
  let ext = '.bin';

  if (input.trusted) {
    ext = mime === 'application/pdf' ? '.pdf' : '.bin';
  } else {
    const match = SIGNATURES.find((s) => s.test(buffer));
    if (!match) throw unsupportedMedia('That file type is not supported. Use JPG, PNG, WebP or PDF.');
    // A mismatch between what was declared and what the bytes say is hostile.
    if (input.declaredMime && input.declaredMime !== match.mime) {
      throw unsupportedMedia('The file contents do not match the declared type.');
    }
    mime = match.mime;
    ext = match.ext;
  }

  // SVG is deliberately absent from the allow-list: it can carry script.
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const storageKey = buildStorageKey({
    tenant: input.providerId ?? input.ownerUserId,
    kind: input.kind,
    filename: `upload${ext}`,
  });

  await getStorage().put(storageKey, buffer, mime);

  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO files (owner_user_id, provider_id, storage_key, original_name, mime_type,
                        size_bytes, sha256, kind, scan_status, visibility)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [input.ownerUserId, input.providerId ?? null, storageKey,
     input.originalName?.slice(0, 200) ?? null, mime, buffer.length, sha256, input.kind,
     input.trusted ? 'clean' : 'pending', input.visibility ?? 'private'],
  );

  // User uploads stay quarantined (scan_status='pending') and are excluded
  // from public reads until the scanner clears them.
  if (!input.trusted) {
    await enqueue('file.scan', { fileId: rows[0].id }, { dedupeKey: `scan:${rows[0].id}` });
  }

  return { id: rows[0].id, storageKey, mime, sizeBytes: buffer.length, sha256 };
}

export function acceptedMimeTypes(): string[] {
  return SIGNATURES.map((s) => s.mime);
}
