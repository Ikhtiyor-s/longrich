import { isValidGtinChecksum } from './gtin-checksum';

describe('isValidGtinChecksum', () => {
  it('accepts a valid GTIN-8', () => {
    expect(isValidGtinChecksum('12345670')).toBe(true);
  });

  it('accepts a valid UPC-12', () => {
    expect(isValidGtinChecksum('123456789012')).toBe(true);
  });

  it('accepts a valid EAN-13', () => {
    expect(isValidGtinChecksum('1234567890128')).toBe(true);
  });

  it('accepts a valid GTIN-14', () => {
    expect(isValidGtinChecksum('04006381333931')).toBe(true);
  });

  it('rejects a GTIN-8 with a corrupted check digit', () => {
    expect(isValidGtinChecksum('12345671')).toBe(false);
  });

  it('rejects a UPC-12 with a corrupted check digit', () => {
    expect(isValidGtinChecksum('123456789011')).toBe(false);
  });

  it('rejects an EAN-13 with a corrupted check digit', () => {
    expect(isValidGtinChecksum('1234567890129')).toBe(false);
  });

  it('rejects a GTIN-14 with a corrupted check digit', () => {
    expect(isValidGtinChecksum('04006381333930')).toBe(false);
  });

  it('rejects a value with a disallowed length (not 8/12/13/14 digits)', () => {
    expect(isValidGtinChecksum('123456789')).toBe(false);
    expect(isValidGtinChecksum('1234567890')).toBe(false);
    expect(isValidGtinChecksum('123456789012345')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidGtinChecksum('1234567A')).toBe(false);
    expect(isValidGtinChecksum('abcdefgh')).toBe(false);
    expect(isValidGtinChecksum('')).toBe(false);
  });

  it('rejects input containing whitespace or symbols', () => {
    expect(isValidGtinChecksum('1234 5670')).toBe(false);
    expect(isValidGtinChecksum('1234-5670')).toBe(false);
  });
});
