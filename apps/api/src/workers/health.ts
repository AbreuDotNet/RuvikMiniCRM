import http from 'node:http';
import { logger } from '../lib/logger.js';

/**
 * Liveness for the standalone worker process.
 *
 * The worker serves no HTTP of its own, so from the outside "process is up"
 * was the only available signal — and that is precisely the signal that fails
 * to catch the failure that matters. The poll loop schedules its next
 * iteration only after the current one settles, so a handler that never
 * resolves stops the loop permanently while the process stays alive: green
 * everywhere, queue growing, nothing red.
 *
 * So health here answers "is the loop still turning?", not "is the process
 * alive?". It is deliberately dependency-free: no database, no Redis. A probe
 * that touched the database would report every worker unhealthy during a brief
 * outage and trigger a restart storm at the worst possible moment.
 */

export interface WorkerStatus {
  /** False before startWorkers() and after stopWorkers(). */
  running: boolean;
  /** Epoch ms of the last observed progress: a tick beginning or a job settling. */
  lastProgressAt: number;
}

export type HealthReason = 'ok' | 'stopped' | 'stalled';

export interface HealthVerdict {
  healthy: boolean;
  reason: HealthReason;
  staleMs: number;
}

/** Pure so the staleness rule can be tested without sockets or timers. */
export function evaluateHealth(status: WorkerStatus, now: number, timeoutMs: number): HealthVerdict {
  // Clamp: a clock adjustment must not read as "fresh forever".
  const staleMs = Math.max(0, now - status.lastProgressAt);
  if (!status.running) return { healthy: false, reason: 'stopped', staleMs };
  if (staleMs > timeoutMs) return { healthy: false, reason: 'stalled', staleMs };
  return { healthy: true, reason: 'ok', staleMs };
}

export interface HealthServerOptions {
  port: number;
  /**
   * Defaults to all interfaces because a Kubernetes httpGet probe connects to
   * the pod IP, not to loopback — binding to 127.0.0.1 would make the probe
   * fail everywhere except a container-local `docker` healthcheck. The port is
   * never published in compose and the payload carries no sensitive data.
   */
  host?: string;
  timeoutMs: number;
  /** Injectable for tests. */
  now?: () => number;
}

/**
 * Starts the liveness endpoint. Returns immediately; listen errors are logged
 * rather than thrown, because failing to serve a probe is not a reason to stop
 * draining the queue — the orchestrator will act on the missing probe itself.
 */
export function createWorkerHealthServer(
  getStatus: () => WorkerStatus,
  opts: HealthServerOptions,
): http.Server {
  const { port, host = '0.0.0.0', timeoutMs, now = Date.now } = opts;

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }

    // Strip any query string before matching.
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname !== '/health') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(method === 'HEAD' ? undefined : JSON.stringify({ error: 'not_found' }));
      return;
    }

    const verdict = evaluateHealth(getStatus(), now(), timeoutMs);
    const body = JSON.stringify({
      status: verdict.healthy ? 'ok' : 'unhealthy',
      service: 'ruvik-worker',
      reason: verdict.reason,
      staleMs: verdict.staleMs,
    });

    res.writeHead(verdict.healthy ? 200 : 503, {
      'content-type': 'application/json',
      // A cached probe response would defeat the point.
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(method === 'HEAD' ? undefined : body);
  });

  server.on('error', (err) => {
    logger.error({ err, port }, 'worker health server error');
  });

  server.listen(port, host, () => {
    logger.info({ port, host, timeoutMs }, 'worker liveness endpoint listening');
  });

  return server;
}

/** Closes the probe listener without waiting on idle keep-alive sockets. */
export async function closeHealthServer(server: http.Server): Promise<void> {
  // Node >= 18.2. Without this, a probe's keep-alive connection can hold
  // close() open until the shutdown timeout fires.
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
