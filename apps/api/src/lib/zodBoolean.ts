import { z } from 'zod';

/**
 * Boolean parsed from a string.
 *
 * `z.coerce.boolean()` is wrong for env vars and query strings: it applies
 * JavaScript truthiness, so the string "false" becomes `true` and any
 * feature flag set to "false" silently stays on. This parses the literal.
 */
export const booleanish = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((value, ctx) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalised = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalised)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalised)) return false;
    ctx.addIssue({ code: 'custom', message: 'Must be true or false.' });
    return z.NEVER;
  });
