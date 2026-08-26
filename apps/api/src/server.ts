import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { getDb, resetDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { startWorkers, stopWorkers } from './workers/runner.js';

async function main() {
  await runMigrations();
  await getDb();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Ruvik API listening');
  });

  // Workers run in-process for single-node deployments; set WORKER_MODE=external
  // to run `npm run worker` as its own scalable process instead.
  const inProcessWorkers = process.env.WORKER_MODE !== 'external';
  if (inProcessWorkers) startWorkers();

  /**
   * Graceful shutdown: stop accepting connections, let in-flight requests
   * finish, then release the pool. A hard exit here would drop responses and
   * leave queue rows locked.
   */
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      if (inProcessWorkers) await stopWorkers();
      await resetDb();
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
