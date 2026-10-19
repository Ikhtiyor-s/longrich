import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Keyed HMAC, not a plain hash: a 6-digit code has only 1,000,000 possible values,
// so an unkeyed hash of it would be offline-crackable in a leaked-table scenario.
// challenge_id is mixed into the message so no single rainbow table works across
// challenges. See docs/architecture/g0-design-notes.md §1.
export function hashOtpCode(challengeId: string, code: string, secret: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export function generateRefreshTokenValue(): string {
  return randomBytes(32).toString('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
