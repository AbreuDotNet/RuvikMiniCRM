import { describe, it, expect } from 'vitest';
import {
  hashPassword, verifyPassword, encrypt, decrypt, sha256, hmac, timingSafeEqual, randomToken,
} from '../../src/lib/crypto.js';

describe('password hashing', () => {
  it('produces an Argon2id hash and verifies it', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-7');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Correct-Horse-Battery-7')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-7');
    expect(await verifyPassword(hash, 'wrong-password-entirely')).toBe(false);
  });

  it('salts each hash, so identical passwords differ on disk', async () => {
    const a = await hashPassword('same-password-value');
    const b = await hashPassword('same-password-value');
    expect(a).not.toBe(b);
  });

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('at-rest encryption', () => {
  it('round-trips a value', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('value')).not.toBe(encrypt('value'));
  });

  it('rejects tampered ciphertext via the GCM auth tag', () => {
    const payload = encrypt('sensitive');
    const parts = payload.split('.');
    // Flip the ciphertext segment.
    parts[3] = Buffer.from('tampered-content').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => decrypt('garbage')).toThrow('malformed ciphertext');
  });
});

describe('hashing helpers', () => {
  it('sha256 is deterministic', () => {
    expect(sha256('token')).toBe(sha256('token'));
    expect(sha256('token')).not.toBe(sha256('token2'));
  });

  it('hmac is keyed, so the digest is not reversible from the DB alone', () => {
    expect(hmac('+18095551234', 'key-a')).not.toBe(hmac('+18095551234', 'key-b'));
  });

  it('timingSafeEqual compares correctly for equal and unequal lengths', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
  });

  it('randomToken is URL-safe and unique', () => {
    const a = randomToken(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(randomToken(32));
  });
});
