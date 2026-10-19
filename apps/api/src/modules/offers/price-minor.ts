import { ValidationError } from '../../common/http/api-error';

// price_minor is the frozen wire representation (api-contract-g2.md): a JSON
// string of digits, parsed server-side to BigInt. This is the single place
// that parsing happens — every call site (create/update) routes through
// here so "no floating-point path exists anywhere in the price-handling
// code" (this ticket's own done-criteria wording) stays true by
// construction, not by convention each call site has to remember.
const DIGITS_ONLY_PATTERN = /^[0-9]+$/;

export function parsePositivePriceMinor(value: string, field = 'price_minor'): bigint {
  if (typeof value !== 'string' || !DIGITS_ONLY_PATTERN.test(value)) {
    throw new ValidationError('price_minor must be a positive integer digit string.', {
      [field]: ['must be a digit string, e.g. "4500000"'],
    });
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new ValidationError('price_minor must be greater than zero.', {
      [field]: ['must be a positive integer greater than zero'],
    });
  }

  return parsed;
}
