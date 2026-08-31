import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { getDb } from './db/index.js';
import { queueDepth } from './lib/queue.js';
import { requestContext } from './middleware/requestContext.js';
import { errorHandler, notFoundHandler, asyncHandler } from './middleware/errorHandler.js';
import { limiters } from './middleware/rateLimit.js';

import { authRouter } from './modules/auth/routes.js';
import { discoveryRouter } from './modules/discovery/routes.js';
import { providerRouter } from './modules/provider/routes.js';
import { crmRouter } from './modules/crm/routes.js';
import { quotesRouter } from './modules/quotes/routes.js';
import { invoicesRouter } from './modules/invoices/routes.js';
import { customerRouter } from './modules/customer/routes.js';
import { billingRouter } from './modules/billing/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { filesRouter } from './modules/files/routes.js';
import { accountRouter } from './modules/account/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { webhooksRouter } from './modules/webhooks/routes.js';

export function createApp(): Express {
  const app = express();

  // Behind a load balancer, req.ip must come from X-Forwarded-For — but only
  // the hops we control, otherwise a client can spoof its own IP and dodge
  // the rate limiter.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      hsts: env.isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // Strict allow-list. `credentials` is on because the refresh cookie needs
  // it, which makes a wildcard origin both invalid and dangerous.
  const allowedOrigins = new Set([env.WEB_BASE_URL, 'http://localhost:5173', 'http://127.0.0.1:5173']);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true); // native apps and curl send no Origin
        if (allowedOrigins.has(origin)) return callback(null, true);
        // Not an error. A disallowed origin simply gets no
        // Access-Control-Allow-Origin header, which is what the fetch spec
        // asks for: the browser refuses to expose the response to the page.
        // Raising instead turned a routine browser-side rejection into an
        // unhandled 500 and filled the error log with phantom server faults.
        //
        // CORS is not authorisation — Origin is trivially forged off-browser —
        // so this must not be mistaken for an access control. The real
        // controls are authentication and the CSRF defences around them.
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(cookieParser());

  if (!env.isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as Request).requestId ?? 'unknown',
        customLogLevel(_req, res, err) {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        // Health checks would otherwise dominate the log volume.
        autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
      }),
    );
  }

  /**
   * Webhooks are mounted before the JSON parser and keep their raw body,
   * because a signature must be verified over the exact bytes received —
   * re-serialising parsed JSON would change them.
   */
  app.use(
    '/api/v1/webhooks',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (req, _res, next) => {
      if (Buffer.isBuffer(req.body)) {
        (req as Request & { rawBody?: Buffer }).rawBody = req.body;
      }
      next();
    },
    webhooksRouter,
  );

  // File uploads set their own raw parser on the route; everything else is JSON.
  app.use(express.json({ limit: env.MAX_JSON_BYTES }));
  app.use(express.urlencoded({ extended: false, limit: env.MAX_JSON_BYTES }));

  /* ------------------------------- health -------------------------------- */

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ruvik-api', version: 'v1', time: new Date().toISOString() });
  });

  /** Readiness proves the dependencies are reachable, not just the process. */
  app.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      const checks: Record<string, string> = {};
      let healthy = true;
      try {
        const db = await getDb();
        await db.query('SELECT 1');
        checks.database = 'ok';
      } catch {
        checks.database = 'unavailable';
        healthy = false;
      }
      try {
        const depth = await queueDepth();
        checks.queue = 'ok';
        checks.queuePending = String(depth.pending ?? 0);
      } catch {
        checks.queue = 'unavailable';
        healthy = false;
      }
      res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'degraded', checks });
    }),
  );

  /* -------------------------------- API v1 ------------------------------- */

  const v1 = express.Router();
  v1.use(limiters.global);

  v1.use('/auth', authRouter);
  v1.use('/', discoveryRouter);            // public search, categories, profiles
  v1.use('/billing', billingRouter);       // plans are public; the rest is guarded
  v1.use('/provider', providerRouter);
  v1.use('/provider', crmRouter);          // clients, jobs, calendar
  v1.use('/quotes', quotesRouter);
  v1.use('/invoices', invoicesRouter);
  v1.use('/customer', customerRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/files', filesRouter);
  v1.use('/account', accountRouter);
  v1.use('/admin', adminRouter);

  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
