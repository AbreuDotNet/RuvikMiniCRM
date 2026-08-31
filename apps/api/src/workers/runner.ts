import { claimJobs, completeJob, failJob, enqueue } from '../lib/queue.js';
import { HANDLERS } from './handlers.js';
import { logger } from '../lib/logger.js';
import { getDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { env } from '../config/env.js';
import { createWorkerHealthServer, closeHealthServer, type WorkerStatus } from './health.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 5;

let running = false;
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> = Promise.resolve();
let lastProgressAt = Date.now();

/** Marks that the poll loop is still turning; see health.ts for why this exists. */
function beat(): void {
  lastProgressAt = Date.now();
}

/** Snapshot for the liveness probe. */
export function workerStatus(): WorkerStatus {
  return { running, lastProgressAt };
}

async function tick(): Promise<void> {
  const jobs = await claimJobs(BATCH_SIZE);
  if (!jobs.length) return;

  // Jobs within a batch are independent, so they run concurrently; failures
  // are isolated per job rather than failing the batch.
  await Promise.all(
    jobs.map(async (job) => {
      const handler = HANDLERS[job.queue];
      if (!handler) {
        await failJob(job, new Error(`No handler registered for queue "${job.queue}"`));
        return;
      }
      const started = Date.now();
      try {
        await handler(job.payload);
        await completeJob(job.id);
        logger.debug({ queue: job.queue, jobId: job.id, ms: Date.now() - started }, 'job completed');
      } catch (err) {
        await failJob(job, err);
      } finally {
        // A slow batch must not let the heartbeat go stale: every job that
        // settles is fresh proof the loop is still making progress.
        beat();
      }
    }),
  );
}

export function startWorkers(): void {
  if (running) return;
  running = true;
  beat();
  logger.info('background workers started');

  const loop = async () => {
    if (!running) return;
    // Beat before the tick, not after: if the tick never settles, this
    // timestamp ages and the probe reports the stall instead of hiding it.
    beat();
    inFlight = tick().catch((err) => {
      logger.error({ err }, 'worker tick failed');
    });
    await inFlight;
    if (running) timer = setTimeout(loop, POLL_INTERVAL_MS);
  };
  void loop();

  // Daily sweep for invoices that passed their due date.
  void enqueue('invoice.overdue', {}, { dedupeKey: `overdue:${new Date().toISOString().slice(0, 10)}` });
}

export async function stopWorkers(): Promise<void> {
  running = false;
  if (timer) clearTimeout(timer);
  await inFlight;
  logger.info('background workers stopped');
}

/** Standalone worker process: `npm run worker`. */
const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntrypoint) {
  (async () => {
    await runMigrations();
    await getDb();
    startWorkers();

    /**
     * Only the standalone process needs this. When WORKER_MODE is in-process
     * the API already serves /health in the same process, and a second
     * listener there would be redundant at best.
     */
    const health = createWorkerHealthServer(workerStatus, {
      port: env.WORKER_HEALTH_PORT,
      timeoutMs: env.WORKER_HEARTBEAT_TIMEOUT_MS,
    });

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      // A second SIGTERM must not race the first shutdown to process.exit.
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'worker shutting down');
      // Stop the probe first: once shutdown begins the answer is "not ready",
      // and stopWorkers() waits for the in-flight batch to drain.
      await closeHealthServer(health);
      await stopWorkers();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  })().catch((err) => {
    logger.fatal({ err }, 'worker failed to start');
    process.exit(1);
  });
}
