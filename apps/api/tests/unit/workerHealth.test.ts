import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  evaluateHealth,
  createWorkerHealthServer,
  closeHealthServer,
  type WorkerStatus,
} from '../../src/workers/health.js';

const TIMEOUT_MS = 60_000;
const NOW = 1_700_000_000_000;

describe('evaluateHealth', () => {
  const running = (lastProgressAt: number): WorkerStatus => ({ running: true, lastProgressAt });

  it('is healthy while the loop keeps beating', () => {
    expect(evaluateHealth(running(NOW - 1_000), NOW, TIMEOUT_MS)).toEqual({
      healthy: true,
      reason: 'ok',
      staleMs: 1_000,
    });
  });

  it('reports a stall once progress is older than the threshold', () => {
    // The failure this whole endpoint exists for: process alive, loop wedged.
    const verdict = evaluateHealth(running(NOW - TIMEOUT_MS - 1), NOW, TIMEOUT_MS);
    expect(verdict.healthy).toBe(false);
    expect(verdict.reason).toBe('stalled');
  });

  it('treats the threshold itself as still healthy', () => {
    // Exactly at the limit must not flap: only strictly older is a stall.
    expect(evaluateHealth(running(NOW - TIMEOUT_MS), NOW, TIMEOUT_MS).healthy).toBe(true);
  });

  it('is unhealthy before start and after stop, however fresh the timestamp', () => {
    const verdict = evaluateHealth({ running: false, lastProgressAt: NOW }, NOW, TIMEOUT_MS);
    expect(verdict).toEqual({ healthy: false, reason: 'stopped', staleMs: 0 });
  });

  it('does not read a backwards clock as fresh forever', () => {
    // A clock adjustment could make now < lastProgressAt; staleMs must floor at 0
    // rather than go negative and mask a real stall later.
    expect(evaluateHealth(running(NOW + 5_000), NOW, TIMEOUT_MS).staleMs).toBe(0);
  });
});

describe('worker liveness endpoint', () => {
  let server: Server | null = null;
  let status: WorkerStatus = { running: true, lastProgressAt: 0 };

  const listen = async (now: () => number): Promise<string> => {
    // Port 0: the OS picks a free one, so the suite cannot collide with a
    // running worker or with itself.
    server = createWorkerHealthServer(() => status, { port: 0, host: '127.0.0.1', timeoutMs: TIMEOUT_MS, now });
    await new Promise<void>((resolve, reject) => {
      server!.once('listening', resolve);
      server!.once('error', reject);
    });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  afterEach(async () => {
    if (server) await closeHealthServer(server);
    server = null;
  });

  it('answers 200 when the loop is turning', async () => {
    status = { running: true, lastProgressAt: NOW - 500 };
    const base = await listen(() => NOW);

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toMatchObject({ status: 'ok', service: 'ruvik-worker' });
  });

  it('answers 503 when the loop has stalled', async () => {
    status = { running: true, lastProgressAt: NOW - TIMEOUT_MS - 1 };
    const base = await listen(() => NOW);

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ status: 'unhealthy', reason: 'stalled' });
  });

  it('answers 503 while shutting down', async () => {
    status = { running: false, lastProgressAt: NOW };
    const base = await listen(() => NOW);

    expect((await fetch(`${base}/health`)).status).toBe(503);
  });

  it('ignores a query string when matching the path', async () => {
    status = { running: true, lastProgressAt: NOW };
    const base = await listen(() => NOW);

    expect((await fetch(`${base}/health?probe=docker`)).status).toBe(200);
  });

  it('does not answer on other paths or methods', async () => {
    status = { running: true, lastProgressAt: NOW };
    const base = await listen(() => NOW);

    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(405);
  });

  it('reflects a stall that develops while the server is up', async () => {
    // Time advances between probes; the same server must change its verdict.
    let clock = NOW;
    status = { running: true, lastProgressAt: NOW };
    const base = await listen(() => clock);

    expect((await fetch(`${base}/health`)).status).toBe(200);
    clock = NOW + TIMEOUT_MS + 1;
    expect((await fetch(`${base}/health`)).status).toBe(503);
  });
});
