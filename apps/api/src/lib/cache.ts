import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Small cache/counter abstraction. Backed by Redis when REDIS_URL is set,
 * otherwise by an in-process map so the platform runs on a single node
 * with no extra infrastructure. Rate limiting and caching both use it.
 */
export interface CacheDriver {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomic increment with TTL applied on first write. Returns the new count. */
  incr(key: string, ttlSeconds: number): Promise<{ count: number; ttlSeconds: number }>;
  name: string;
}

function createMemoryDriver(): CacheDriver {
  const store = new Map<string, { value: string; expiresAt: number }>();

  const sweep = () => {
    const now = Date.now();
    for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
  };
  const timer = setInterval(sweep, 30_000);
  timer.unref?.();

  const read = (key: string) => {
    const hit = store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return hit;
  };

  return {
    name: 'memory',
    async get(key) {
      return read(key)?.value ?? null;
    },
    async set(key, value, ttlSeconds = 300) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key) {
      store.delete(key);
    },
    async incr(key, ttlSeconds) {
      const hit = read(key);
      if (!hit) {
        store.set(key, { value: '1', expiresAt: Date.now() + ttlSeconds * 1000 });
        return { count: 1, ttlSeconds };
      }
      const count = Number(hit.value) + 1;
      hit.value = String(count);
      return { count, ttlSeconds: Math.max(1, Math.ceil((hit.expiresAt - Date.now()) / 1000)) };
    },
  };
}

async function createRedisDriver(url: string): Promise<CacheDriver> {
  const { createClient } = await import('redis');
  const client = createClient({ url });
  client.on('error', (err: unknown) => logger.error({ err }, 'redis error'));
  await client.connect();

  return {
    name: 'redis',
    async get(key) {
      return (await client.get(key)) as string | null;
    },
    async set(key, value, ttlSeconds = 300) {
      await client.set(key, value, { EX: ttlSeconds });
    },
    async del(key) {
      await client.del(key);
    },
    async incr(key, ttlSeconds) {
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, ttlSeconds);
      const ttl = await client.ttl(key);
      return { count, ttlSeconds: ttl > 0 ? ttl : ttlSeconds };
    },
  };
}

let driver: CacheDriver | null = null;

export async function getCache(): Promise<CacheDriver> {
  if (driver) return driver;
  if (env.REDIS_URL) {
    try {
      driver = await createRedisDriver(env.REDIS_URL);
      logger.info('cache driver: redis');
      return driver;
    } catch (err) {
      // Degrade gracefully rather than refusing to boot.
      logger.error({ err }, 'redis unavailable, falling back to in-memory cache');
    }
  }
  driver = createMemoryDriver();
  logger.info('cache driver: memory');
  return driver;
}

export async function resetCache(): Promise<void> {
  driver = null;
}
