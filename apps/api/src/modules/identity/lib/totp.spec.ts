import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotpSecretBase32,
  totp,
  verifyTotp,
} from './totp';

describe('base32Encode / base32Decode', () => {
  it('round-trips arbitrary byte buffers', () => {
    const original = Buffer.from('12345678901234567890', 'ascii');
    const encoded = base32Encode(original);
    expect(base32Decode(encoded)).toEqual(original);
  });
});

describe('generateTotpSecretBase32', () => {
  it('produces a different secret on every call', () => {
    const a = generateTotpSecretBase32();
    const b = generateTotpSecretBase32();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('totp (RFC 6238 Appendix B test vector, SHA1, truncated to 6 digits)', () => {
  // RFC 6238's own 8-digit vector at T=59s is 94287082; the last 6 digits
  // (94287082 mod 1_000_000 = 287082) is what our 6-digit truncation produces.
  const rfcSecretBase32 = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

  it('matches the known RFC 6238 vector at Unix time 59', () => {
    expect(totp(rfcSecretBase32, 59_000)).toBe('287082');
  });

  it('produces a different code once the 30s window rolls over', () => {
    const windowOne = totp(rfcSecretBase32, 59_000);
    const windowTwo = totp(rfcSecretBase32, 61_000);
    expect(windowTwo).not.toBe(windowOne);
  });
});

describe('verifyTotp', () => {
  const secret = generateTotpSecretBase32();

  it('accepts the current window code', () => {
    const now = Date.now();
    const code = totp(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
  });

  it('accepts a code from one window of clock drift (tolerance)', () => {
    const now = Date.now();
    const previousWindowCode = totp(secret, now - 30_000);
    expect(verifyTotp(secret, previousWindowCode, now)).toBe(true);
  });

  it('rejects a code that is outside the drift tolerance', () => {
    const now = Date.now();
    const staleCode = totp(secret, now - 120_000);
    expect(verifyTotp(secret, staleCode, now)).toBe(false);
  });

  it('rejects a wrong code for the right secret', () => {
    const now = Date.now();
    const correct = totp(secret, now);
    const wrong = correct === '000000' ? '111111' : '000000';
    expect(verifyTotp(secret, wrong, now)).toBe(false);
  });
});

describe('buildOtpauthUri', () => {
  it('never includes the raw secret value unencoded/mislabeled and carries the expected params', () => {
    const secret = generateTotpSecretBase32();
    const uri = buildOtpauthUri(secret, 'admin-member-1', 'Longrich');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=Longrich');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
