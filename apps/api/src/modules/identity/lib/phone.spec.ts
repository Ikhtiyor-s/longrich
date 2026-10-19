import { isValidE164, maskPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('accepts an already-valid E.164 number unchanged', () => {
    expect(normalizePhone('+998901234567')).toBe('+998901234567');
  });

  it('normalizes a bare 998-prefixed number by adding +', () => {
    expect(normalizePhone('998901234567')).toBe('+998901234567');
  });

  it('normalizes a 9-digit local subscriber number to +998', () => {
    expect(normalizePhone('901234567')).toBe('+998901234567');
  });

  it('normalizes a 0-prefixed trunk-format number to +998', () => {
    expect(normalizePhone('0901234567')).toBe('+998901234567');
  });

  it('strips spaces and dashes before normalizing', () => {
    expect(normalizePhone('+998 90-123-45-67')).toBe('+998901234567');
  });

  it('rejects a malformed/too-short input', () => {
    expect(normalizePhone('12345')).toBeNull();
  });

  it('rejects a non-string input', () => {
    expect(normalizePhone(42 as unknown)).toBeNull();
  });

  it('rejects empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });
});

describe('isValidE164', () => {
  it('accepts a valid E.164 string', () => {
    expect(isValidE164('+998901234567')).toBe(true);
  });

  it('rejects a number missing the leading +', () => {
    expect(isValidE164('998901234567')).toBe(false);
  });

  it('rejects a number with a leading zero digit after +', () => {
    expect(isValidE164('+0901234567')).toBe(false);
  });
});

describe('maskPhone', () => {
  it('masks the middle digits, keeping country-code prefix and last 4 digits', () => {
    expect(maskPhone('+998901234567')).toBe('+998***4567');
  });

  it('falls back to a generic mask for very short input', () => {
    expect(maskPhone('+1234')).toBe('***');
  });
});
