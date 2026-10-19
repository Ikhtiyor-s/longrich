import {
  generateOtpCode,
  generateRefreshTokenValue,
  hashOtpCode,
  sha256Hex,
  timingSafeEqualHex,
} from './crypto';

describe('generateOtpCode', () => {
  it('always produces a 6-digit zero-padded numeric string', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashOtpCode', () => {
  it('is deterministic for the same challenge/code/secret', () => {
    const a = hashOtpCode('challenge-1', '482913', 'secret');
    const b = hashOtpCode('challenge-1', '482913', 'secret');
    expect(a).toBe(b);
  });

  it('differs when the challenge_id differs (no cross-challenge rainbow table)', () => {
    const a = hashOtpCode('challenge-1', '482913', 'secret');
    const b = hashOtpCode('challenge-2', '482913', 'secret');
    expect(a).not.toBe(b);
  });

  it('differs when the secret differs', () => {
    const a = hashOtpCode('challenge-1', '482913', 'secret-a');
    const b = hashOtpCode('challenge-1', '482913', 'secret-b');
    expect(a).not.toBe(b);
  });
});

describe('timingSafeEqualHex', () => {
  it('returns true for identical hex strings', () => {
    const hash = hashOtpCode('challenge-1', '482913', 'secret');
    expect(timingSafeEqualHex(hash, hash)).toBe(true);
  });

  it('returns false for different hex strings of the same length', () => {
    const a = hashOtpCode('challenge-1', '482913', 'secret');
    const b = hashOtpCode('challenge-1', '000000', 'secret');
    expect(timingSafeEqualHex(a, b)).toBe(false);
  });

  it('returns false (not throws) for mismatched lengths', () => {
    expect(timingSafeEqualHex('ab', 'abcd')).toBe(false);
  });
});

describe('generateRefreshTokenValue / sha256Hex', () => {
  it('generates a sufficiently long random token each call', () => {
    const a = generateRefreshTokenValue();
    const b = generateRefreshTokenValue();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it('sha256Hex is deterministic', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
  });
});
