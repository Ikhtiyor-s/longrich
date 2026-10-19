const VALID_GTIN_LENGTHS = [8, 12, 13, 14];

// GS1 General Specifications mod-10 check digit: scanning right-to-left from
// the digit immediately left of the check digit, weights alternate 3, 1, 3,
// 1... — the same algorithm underlies GTIN-8/12/13/14 regardless of length
// (shorter codes are the same right-aligned scheme), so one implementation
// covers GTIN/EAN/UPC.
export function isValidGtinChecksum(value: string): boolean {
  if (!/^\d+$/.test(value) || !VALID_GTIN_LENGTHS.includes(value.length)) {
    return false;
  }

  const digits = value.split('').map(Number);
  const checkDigit = digits[digits.length - 1] as number;
  const payload = digits.slice(0, -1);

  let sum = 0;
  let weight = 3;
  for (let i = payload.length - 1; i >= 0; i -= 1) {
    sum += (payload[i] as number) * weight;
    weight = weight === 3 ? 1 : 3;
  }

  const computedCheckDigit = (10 - (sum % 10)) % 10;
  return computedCheckDigit === checkDigit;
}
