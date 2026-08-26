import { claimJobs, completeJob, failJob, enqueue } from '../lib/queue.js';
import { HANDLERS } from './handlers.js';
import { logger } from '../lib/logger.js';
import { getDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 5;

let running = false;
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> = Promise.resolve();

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
      }
    }),
  );
}

export function startWorkers(): void {
  if (running) return;
  running = true;
  logger.info('background workers started');

  const loop = async () => {
    if (!running) return;
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
    process.on('SIGTERM', () => void stopWorkers().then(() => process.exit(0)));
    process.on('SIGINT', () => void stopWorkers().then(() => process.exit(0)));
  })().catch((err) => {
    logger.fatal({ err }, 'worker failed to start');
    process.exit(1);
  });
}
