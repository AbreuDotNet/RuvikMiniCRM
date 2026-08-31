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
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Country code assumed for a number typed without one. The launch market is
 * the United States, and +1 also covers Canada, Puerto Rico and the Dominican
 * Republic, which share the North American Numbering Plan.
 */
const NANP_COUNTRY_CODE = '1';

/** NANP national number: neither the area code nor the exchange may start with 0 or 1. */
const NANP_NATIONAL = /^[2-9]\d{2}[2-9]\d{6}$/;

/**
 * Accepts how people actually type phone numbers and stores E.164.
 *
 * Requiring the caller to type `+1` was a steady source of rejected forms for
 * a number that was perfectly valid — the format is a storage concern, not
 * something to make the user solve.
 *
 * Deliberately NANP-only. "Prepend the country code" is not a general rule:
 * Spanish numbers are 9 digits, UK numbers carry a trunk 0 that has to be
 * dropped first. Launching in another market needs its own branch here, not a
 * different value in the constant above.
 *
 * A number that already starts with `+` is never re-homed — only stripped of
 * formatting — so an international caller can always be explicit. Anything
 * this cannot resolve is returned unchanged for the schema to reject, rather
 * than guessed at.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  // Explicit country code: keep it, drop spaces, dashes and parentheses.
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;

  const digits = trimmed.replace(/\D/g, '');

  // 00 is the international access prefix across most of the world.
  if (digits.startsWith('00') && digits.length > 2) return `+${digits.slice(2)}`;

  // 1-809-555-1234 → +18095551234
  if (
    digits.length === 11 &&
    digits.startsWith(NANP_COUNTRY_CODE) &&
    NANP_NATIONAL.test(digits.slice(1))
  ) {
    return `+${digits}`;
  }

  // (809) 555-1234 → +18095551234
  if (digits.length === 10 && NANP_NATIONAL.test(digits)) {
    return `+${NANP_COUNTRY_CODE}${digits}`;
  }

  return trimmed;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => E164.test(v), 'Enter a valid phone number, e.g. (809) 555-1234 or +18095551234');

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
