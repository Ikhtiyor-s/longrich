import { computeOptionsHash } from './options-hash';

describe('computeOptionsHash', () => {
  it('is stable regardless of input key order', () => {
    const a = computeOptionsHash({ size: 'L', color: 'red' });
    const b = computeOptionsHash({ color: 'red', size: 'L' });
    expect(a).toBe(b);
  });

  it('produces a different hash for a different value', () => {
    const a = computeOptionsHash({ size: 'L', color: 'red' });
    const b = computeOptionsHash({ size: 'M', color: 'red' });
    expect(a).not.toBe(b);
  });

  it('returns a 64-character hex sha256 digest', () => {
    const hash = computeOptionsHash({ size: 'L' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
