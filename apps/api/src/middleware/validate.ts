import type { Request, Response, NextFunction } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { validationFailed } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validation is allow-list only: the parsed output replaces the raw input,
 * so unknown keys are dropped rather than reaching a data layer. This is
 * what closes mass-assignment (a client cannot smuggle `role` or
 * `provider_id` into an update).
 */
export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => ({
        field: i.path.join('.') || source,
        message: i.message,
        code: i.code,
      }));
      return next(validationFailed(fieldErrors));
    }
    if (source === 'query') {
      // req.query can be a getter depending on Express version; keep the
      // parsed output beside it rather than reassigning.
      (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    } else {
      req[source] = result.data as never;
    }
    next();
  };
}

export function validated<T>(req: Request): T {
  return ((req as Request & { validatedQuery?: unknown }).validatedQuery ?? req.query) as T;
}

/* --------------------------- shared field schemas ------------------------- */

export const uuidSchema = z.string().uuid('Must be a valid id.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254);

/**
 * Password policy follows NIST SP 800-63B: length over composition rules,
 * plus a block list of the passwords attackers try first.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', 'qwertyuiop',
  'letmein', 'welcome1', 'admin123', 'iloveyou', 'monkey123', 'football',
  'abc12345', 'passw0rd', 'trustno1', 'changeme', 'ruvik123',
]);

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use at most 128 characters.')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'That password is too common. Pick another.')
  .refine((p) => new Set(p).size > 4, 'That password is too repetitive.');

/** E.164: leading +, country code, up to 15 digits total. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +18095551234');

/**
 * Strips C0/C1 control characters. These would otherwise corrupt generated
 * PDFs, split log lines, or break out of a CSV cell on export.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

export const safeText = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .transform((s) => s.replace(CONTROL_CHARS, ''));

export const moneyCents = z.number().int().min(0).max(100_000_000);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.');
