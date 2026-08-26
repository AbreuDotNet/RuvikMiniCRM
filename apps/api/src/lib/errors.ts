/**
 * Application errors carry a stable machine-readable `code` plus an HTTP
 * status. Messages are safe to show to end users; internal detail goes to
 * the log, never the response body.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
  }
}

export const badRequest = (msg = 'Invalid request', details?: unknown) =>
  new AppError(400, 'bad_request', msg, details);
export const validationFailed = (details: unknown) =>
  new AppError(422, 'validation_failed', 'Some fields need your attention.', details);
export const unauthorized = (msg = 'Please sign in to continue.') =>
  new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have access to this resource.') =>
  new AppError(403, 'forbidden', msg);
/**
 * 404 is deliberately returned for cross-tenant reads as well, so that an
 * attacker cannot use 403-vs-404 to prove a record exists (BOLA probing).
 */
export const notFound = (msg = 'Not found.') => new AppError(404, 'not_found', msg);
export const conflict = (msg = 'That conflicts with the current state.', details?: unknown) =>
  new AppError(409, 'conflict', msg, details);
export const tooLarge = (msg = 'That file or request is too large.') =>
  new AppError(413, 'payload_too_large', msg);
export const unsupportedMedia = (msg = 'That file type is not supported.') =>
  new AppError(415, 'unsupported_media_type', msg);
export const rateLimited = (msg = 'Too many requests. Please slow down.', retryAfter?: number) =>
  new AppError(429, 'rate_limited', msg, retryAfter ? { retryAfterSeconds: retryAfter } : undefined);
export const serverError = (msg = 'Something went wrong on our side.') =>
  new AppError(500, 'internal_error', msg);
export const serviceUnavailable = (msg = 'That service is temporarily unavailable.') =>
  new AppError(503, 'service_unavailable', msg);
