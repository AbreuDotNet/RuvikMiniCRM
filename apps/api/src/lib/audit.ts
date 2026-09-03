import type { Queryable } from '../db/index.js';
import { getDb } from '../db/index.js';
import { sha256 } from './crypto.js';
import { logger } from './logger.js';

/**
 * Serialises metadata the way it will read back out of the database.
 *
 * The chain hash covers `metadata`, but the value is stored as `jsonb`, which
 * does not keep insertion order — it normalises object keys by length and then
 * bytewise. Hashing the JS object as written and re-hashing the round-tripped
 * one therefore compared two different strings whenever those orders differed,
 * and the chain reported itself broken with nothing having tampered with it.
 * `{reason, from, to, axis}` comes back as `{to, axis, from, reason}`.
 *
 * Sorting by jsonb's own rule rather than plain alphabetical order is
 * deliberate: it leaves the hash of every already-written row that happened to
 * match jsonb's order unchanged, so existing history stays verifiable.
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value === null || typeof value !== 'object') return value;

  const entries = Object.entries(value as Record<string, unknown>);
  entries.sort(([a], [b]) => {
    if (a.length !== b.length) return a.length - b.length;
    // Bytewise on the UTF-8 encoding, which is what Postgres compares.
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    return Buffer.compare(ab, bb);
  });

  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = canonicalise(v);
  return out;
}

export interface AuditInput {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Overrides the timestamp. Only for back-dating demo history: the hash
   * covers this value, so the chain stays verifiable either way, and rows
   * still chain in insertion order rather than by date.
   */
  createdAt?: Date | string;
}

/**
 * Append-only audit trail. Each row's hash covers the previous row's hash,
 * so any deletion or edit of history is detectable by re-walking the chain.
 * Nothing in the codebase ever UPDATEs or DELETEs this table.
 */
export async function writeAudit(input: AuditInput, client?: Queryable): Promise<void> {
  const db = client ?? (await getDb());
  try {
    const { rows } = await db.query<{ hash: string }>(
      'SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1',
    );
    const prevHash = rows[0]?.hash ?? null;
    const createdAt = input.createdAt
      ? new Date(input.createdAt).toISOString()
      : new Date().toISOString();
    const metadata = input.metadata ?? {};
    const payload = JSON.stringify({
      prevHash,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: canonicalise(metadata),
      createdAt,
    });
    const hash = sha256(payload);

    await db.query(
      `INSERT INTO audit_logs
         (actor_user_id, actor_role, action, entity_type, entity_id, ip, user_agent, metadata, prev_hash, hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.actorUserId ?? null,
        input.actorRole ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.ip ?? null,
        input.userAgent ?? null,
        JSON.stringify(metadata),
        prevHash,
        hash,
        createdAt,
      ],
    );
  } catch (err) {
    // Auditing must never take down the request it is recording, but a
    // failure here is an alertable event.
    logger.error({ err, action: input.action }, 'audit write failed');
  }
}

/** Verifies the hash chain. Used by the admin integrity check and by tests. */
export async function verifyAuditChain(limit = 10_000): Promise<{ ok: boolean; brokenAtId?: number }> {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT id, actor_user_id, actor_role, action, entity_type, entity_id,
            metadata, prev_hash, hash, created_at
       FROM audit_logs ORDER BY id ASC LIMIT $1`,
    [limit],
  );

  let expectedPrev: string | null = null;
  for (const row of rows) {
    if ((row.prev_hash ?? null) !== expectedPrev) return { ok: false, brokenAtId: Number(row.id) };
    const createdAt =
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
    const payload = JSON.stringify({
      prevHash: row.prev_hash ?? null,
      actorUserId: row.actor_user_id ?? null,
      actorRole: row.actor_role ?? null,
      action: row.action,
      entityType: row.entity_type ?? null,
      entityId: row.entity_id ?? null,
      metadata: canonicalise(row.metadata ?? {}),
      createdAt,
    });
    if (sha256(payload) !== row.hash) return { ok: false, brokenAtId: Number(row.id) };
    expectedPrev = row.hash;
  }
  return { ok: true };
}
