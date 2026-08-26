import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

/**
 * Every request gets an id that flows into logs and error responses, so a
 * user-reported failure can be traced without asking them for a screenshot.
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
