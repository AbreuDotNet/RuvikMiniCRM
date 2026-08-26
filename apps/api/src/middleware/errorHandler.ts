import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

interface BodyParserError {
  type?: string;
  status?: number;
  statusCode?: number;
}

/**
 * body-parser tags every failure it raises with a dotted `type`
 * ("entity.too.large", "entity.parse.failed", "request.aborted", ...) and an
 * HTTP status. Without this branch those surface as a generic 500.
 */
const BODY_PARSER_TYPES = /^(entity|request|parameters|charset|encoding|stream)\./;

function asBodyParserError(err: unknown): BodyParserError | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as BodyParserError;
  if (typeof candidate.type !== 'string') return null;
  return BODY_PARSER_TYPES.test(candidate.type) ? candidate : null;
}

/** Postgres error codes we can translate into a useful client message. */
const PG_CODES: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'conflict', message: 'That record already exists.' },
  '23503': { status: 409, code: 'conflict', message: 'A related record is missing or still in use.' },
  '23514': { status: 422, code: 'validation_failed', message: 'That value is not allowed.' },
  '22001': { status: 422, code: 'validation_failed', message: 'One of the values is too long.' },
  '57014': { status: 503, code: 'timeout', message: 'That request took too long. Please try again.' },
};

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
    requestId: req.requestId,
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let code = 'internal_error';
  let message = 'Something went wrong on our side. Please try again.';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'validation_failed';
    message = 'Some fields need your attention.';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (asBodyParserError(err)) {
    const parserError = asBodyParserError(err)!;
    const parserStatus = parserError.status ?? parserError.statusCode ?? 400;
    if (parserStatus === 413) {
      status = 413;
      code = 'payload_too_large';
      message = 'That request is too large.';
    } else {
      status = 400;
      code = 'bad_request';
      message = 'The request body could not be read.';
    }
  } else if (typeof err === 'object' && err !== null && 'code' in err) {
    const pg = PG_CODES[String((err as { code: unknown }).code)];
    if (pg) {
      status = pg.status;
      code = pg.code;
      message = pg.message;
    }
  }

  const logPayload = {
    err,
    requestId: req.requestId,
    userId: req.auth?.userId,
    method: req.method,
    path: req.path,
    status,
  };
  if (status >= 500) logger.error(logPayload, 'request failed');
  else logger.warn(logPayload, 'request rejected');

  const body: Record<string, unknown> = { error: { code, message }, requestId: req.requestId };
  if (details !== undefined) (body.error as Record<string, unknown>).details = details;
  // Stack traces never cross the wire, not even in development responses.
  if (!env.isProd && status >= 500 && err instanceof Error) {
    (body.error as Record<string, unknown>).debug = err.message;
  }

  res.status(status).json(body);
}

/** Wraps an async handler so rejected promises reach the error handler. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  fn: T,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
