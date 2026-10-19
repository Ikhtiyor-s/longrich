import { ValidationError } from '../../common/http/api-error';
import { parsePositivePriceMinor } from './price-minor';

describe('parsePositivePriceMinor', () => {
  it('parses a valid positive digit string to a BigInt', () => {
    expect(parsePositivePriceMinor('4500000')).toBe(4500000n);
  });

  it.each(['0', '-1', '5.5', 'abc', '', '+5', ' 5'])(
    'rejects %p with a 422 ValidationError',
    (value) => {
      expect(() => parsePositivePriceMinor(value)).toThrow(ValidationError);
    },
  );

  it('includes the custom field name in details when provided', () => {
    const error = parsePositivePriceMinor as unknown;
    expect(error).toBeDefined();
    try {
      parsePositivePriceMinor('-5', 'new_price_minor');
      fail('expected to throw');
    } catch (e) {
      expect((e as ValidationError).details.new_price_minor).toBeDefined();
    }
  });
});
