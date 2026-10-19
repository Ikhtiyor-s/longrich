import { sanitizeDescription } from './sanitize-description';

describe('sanitizeDescription', () => {
  it('strips HTML tags', () => {
    expect(sanitizeDescription('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('strips a script tag entirely (tags removed, not re-escaped)', () => {
    expect(sanitizeDescription('<script>alert(1)</script>safe')).toBe('alert(1)safe');
  });

  it('leaves plain text untouched aside from trimming', () => {
    expect(sanitizeDescription('  Plain text  ')).toBe('Plain text');
  });
});
