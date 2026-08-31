import { describe, it, expect } from 'vitest';
import { normalizePhone, phoneSchema } from '../../src/middleware/validate.js';

describe('normalizePhone', () => {
  it('adds the launch-market country code to a bare national number', () => {
    // The case that kept rejecting perfectly valid numbers on the job form.
    expect(normalizePhone('8095551234')).toBe('+18095551234');
    expect(normalizePhone('2125550123')).toBe('+12125550123');
  });

  it('accepts the shapes people actually type', () => {
    for (const input of [
      '(809) 555-1234',
      '809-555-1234',
      '809.555.1234',
      '809 555 1234',
      ' 8095551234 ',
      '1-809-555-1234',
      '18095551234',
    ]) {
      expect(normalizePhone(input)).toBe('+18095551234');
    }
  });

  it('leaves an explicit country code alone, only stripping formatting', () => {
    // Never re-home a number the caller was explicit about.
    expect(normalizePhone('+1 (809) 555-1234')).toBe('+18095551234');
    expect(normalizePhone('+34 911 22 33 44')).toBe('+34911223344');
    expect(normalizePhone('+442071234567')).toBe('+442071234567');
  });

  it('treats 00 as the international access prefix', () => {
    expect(normalizePhone('0034911223344')).toBe('+34911223344');
  });

  it('returns unresolvable input unchanged rather than inventing a number', () => {
    // The schema rejects these; guessing here would store a wrong number.
    for (const input of ['not-a-phone', '0123456789', '1123456789', '80955512', '']) {
      expect(normalizePhone(input)).toBe(input.trim());
    }
  });

  it('is idempotent', () => {
    // Re-saving a stored number must not corrupt it.
    const once = normalizePhone('8095551234');
    expect(normalizePhone(once)).toBe(once);
  });
});

describe('phoneSchema', () => {
  it('stores E.164 whatever the caller typed', () => {
    expect(phoneSchema.parse('(809) 555-1234')).toBe('+18095551234');
    expect(phoneSchema.parse('+18095551234')).toBe('+18095551234');
  });

  it('rejects what cannot be resolved', () => {
    for (const bad of ['+0123', 'not-a-phone', '+1809555123456789', '0123456789', '80955512']) {
      expect(phoneSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('still composes with optional and nullable', () => {
    // Every caller wraps it one of these ways; the transform must not break that.
    expect(phoneSchema.optional().parse(undefined)).toBeUndefined();
    expect(phoneSchema.optional().nullable().parse(null)).toBeNull();
    expect(phoneSchema.optional().nullable().parse('8095551234')).toBe('+18095551234');
  });
});
