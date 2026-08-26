import type { Request, Response, NextFunction } from 'express';
import { getCache } from '../lib/cache.js';
import { env } from '../config/env.js';
import { rateLimited } from '../lib/errors.js';

export interface RateLimitOptions {
  /** Bucket name, e.g. 'login'. Keeps limits independent per endpoint class. */
  name: string;
  windowSeconds: number;
  max: number;
  /** Defaults to authenticated user id, falling back to client IP. */
  keyFn?: (req: Request) => string;
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Fixed-window counter. Applied per (bucket, subject) so that one abusive
 * IP cannot exhaust another user's budget, and an authenticated attacker
 * cannot dodge the limit by rotating IPs.
 */
export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!env.RATE_LIMIT_ENABLED) return next();
    try {
      const subject = opts.keyFn ? opts.keyFn(req) : (req.auth?.userId ?? clientIp(req));
      const window = Math.floor(Date.now() / 1000 / opts.windowSeconds);
      const key = `rl:${opts.name}:${subject}:${window}`;

      const cache = await getCache();
      const { count, ttlSeconds } = await cache.incr(key, opts.windowSeconds);

      res.setHeader('RateLimit-Limit', String(opts.max));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, opts.max - count)));
      res.setHeader('RateLimit-Reset', String(ttlSeconds));

      if (count > opts.max) {
        res.setHeader('Retry-After', String(ttlSeconds));
        throw rateLimited('Too many requests. Please wait a moment and try again.', ttlSeconds);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Tuned buckets. Financial and auth paths are deliberately the tightest. */
export const limiters = {
  global: rateLimit({ name: 'global', windowSeconds: 60, max: 300 }),
  auth: rateLimit({ name: 'auth', windowSeconds: 300, max: 10, keyFn: clientIp }),
  // Refresh gets its own budget: a client rotating tokens normally must never
  // eat into the login allowance it shares an IP with.
  refresh: rateLimit({ name: 'refresh', windowSeconds: 300, max: 60, keyFn: clientIp }),
  signup: rateLimit({ name: 'signup', windowSeconds: 3600, max: 5, keyFn: clientIp }),
  passwordReset: rateLimit({ name: 'pwreset', windowSeconds: 3600, max: 5, keyFn: clientIp }),
  search: rateLimit({ name: 'search', windowSeconds: 60, max: 60 }),
  write: rateLimit({ name: 'write', windowSeconds: 60, max: 60 }),
  financial: rateLimit({ name: 'financial', windowSeconds: 60, max: 20 }),
  admin: rateLimit({ name: 'admin', windowSeconds: 60, max: 100 }),
  whatsapp: rateLimit({ name: 'whatsapp', windowSeconds: 3600, max: 30 }),
  upload: rateLimit({ name: 'upload', windowSeconds: 3600, max: 60 }),
};
