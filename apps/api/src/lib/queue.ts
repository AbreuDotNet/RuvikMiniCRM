import crypto from 'node:crypto';
import { getDb, type Queryable } from '../db/index.js';
import { logger } from './logger.js';

export type QueueName =
  | 'pdf.generate'
  | 'whatsapp.send'
  | 'email.send'
  | 'notification.push'
  | 'billing.renew'
  | 'invoice.overdue'
  | 'file.scan';

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  /** Collapses duplicate work (e.g. one PDF render per quote version). */
  dedupeKey?: string;
}

/**
 * Postgres-backed queue. Chosen over Redis for the job table because a
 * dropped invoice or WhatsApp send is a business incident: jobs must survive
 * a restart and be visible to the same transaction that created the record.
 */
export async function enqueue(
  queue: QueueName,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
  client?: Queryable,
): Promise<void> {
  const db = client ?? (await getDb());
  await db.query(
    `INSERT INTO job_queue (queue, payload, run_at, max_attempts, dedupe_key)
     VALUES ($1, $2, COALESCE($3, now()), $4, $5)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing')
     DO NOTHING`,
    [queue, JSON.stringify(payload), opts.runAt ?? null, opts.maxAttempts ?? 5, opts.dedupeKey ?? null],
  );
}

export interface QueuedJob {
  id: string;
  queue: QueueName;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

const WORKER_ID = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
/** Jobs locked longer than this are assumed orphaned by a crashed worker. */
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Claims up to `batchSize` due jobs. SKIP LOCKED lets many workers poll the
 * same table without contending, which is what makes this scale horizontally.
 */
export async function claimJobs(batchSize = 5): Promise<QueuedJob[]> {
  const db = await getDb();
  const staleBefore = new Date(Date.now() - LOCK_TIMEOUT_MS);

  const { rows } = await db.query<QueuedJob>(
    `UPDATE job_queue SET
        status = 'processing',
        locked_at = now(),
        locked_by = $1,
        attempts = attempts + 1,
        updated_at = now()
      WHERE id IN (
        SELECT id FROM job_queue
         WHERE run_at <= now()
           AND (status = 'pending' OR (status = 'processing' AND locked_at < $3))
         ORDER BY run_at, id
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, queue, payload, attempts, max_attempts`,
    [WORKER_ID, batchSize, staleBefore],
  );
  return rows;
}

export async function completeJob(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE job_queue SET status = 'done', locked_at = NULL, locked_by = NULL, updated_at = now()
      WHERE id = $1`,
    [id],
  );
}

/** Exponential backoff with jitter, then the dead-letter table. */
export async function failJob(job: QueuedJob, error: unknown): Promise<void> {
  const db = await getDb();
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.max_attempts;

  if (exhausted) {
    await db.tx(async (c) => {
      await c.query(
        `INSERT INTO dead_letters (queue, payload, attempts, last_error) VALUES ($1,$2,$3,$4)`,
        [job.queue, JSON.stringify(job.payload), job.attempts, message.slice(0, 2000)],
      );
      await c.query(
        `UPDATE job_queue SET status = 'dead', last_error = $2, locked_at = NULL, updated_at = now()
          WHERE id = $1`,
        [job.id, message.slice(0, 2000)],
      );
    });
    logger.error({ queue: job.queue, jobId: job.id, err: message }, 'job dead-lettered');
    return;
  }

  const backoffSeconds = Math.min(3600, 2 ** job.attempts * 5);
  const jitter = Math.floor(Math.random() * backoffSeconds * 0.2);
  const runAt = new Date(Date.now() + (backoffSeconds + jitter) * 1000);

  await db.query(
    `UPDATE job_queue SET status = 'pending', run_at = $2, last_error = $3,
            locked_at = NULL, locked_by = NULL, updated_at = now()
      WHERE id = $1`,
    [job.id, runAt, message.slice(0, 2000)],
  );
  logger.warn({ queue: job.queue, jobId: job.id, attempts: job.attempts, runAt }, 'job retry scheduled');
}

export async function queueDepth(): Promise<Record<string, number>> {
  const db = await getDb();
  const { rows } = await db.query<{ status: string; count: string }>(
    `SELECT status, count(*)::text AS count FROM job_queue GROUP BY status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
}
