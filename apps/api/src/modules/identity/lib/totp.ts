import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecretBase32(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

// RFC 4226 HOTP.
function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac.readUInt8(hmac.length - 1) & 0xf;
  const truncated =
    ((hmac.readUInt8(offset) & 0x7f) << 24) |
    ((hmac.readUInt8(offset + 1) & 0xff) << 16) |
    ((hmac.readUInt8(offset + 2) & 0xff) << 8) |
    (hmac.readUInt8(offset + 3) & 0xff);
  return (truncated % 1_000_000).toString().padStart(6, '0');
}

// RFC 6238 TOTP: HOTP keyed by the number of stepSeconds windows since the epoch.
export function totp(secretBase32: string, time = Date.now(), stepSeconds = 30): string {
  const counter = Math.floor(time / 1000 / stepSeconds);
  return hotp(base32Decode(secretBase32), counter);
}

function constantTimeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Accepts the previous/current/next 30s window to absorb clock drift, same
// tolerance convention as most TOTP implementations (Google Authenticator, etc).
export function verifyTotp(
  secretBase32: string,
  code: string,
  time = Date.now(),
  stepSeconds = 30,
  windowTolerance = 1,
): boolean {
  for (let offset = -windowTolerance; offset <= windowTolerance; offset += 1) {
    const candidate = totp(secretBase32, time + offset * stepSeconds * 1000, stepSeconds);
    if (constantTimeStringEquals(candidate, code)) {
      return true;
    }
  }
  return false;
}

export function buildOtpauthUri(
  secretBase32: string,
  accountLabel: string,
  issuer = 'Longrich',
): string {
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    digits: '6',
    period: '30',
    algorithm: 'SHA1',
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}?${params.toString()}`;
}
