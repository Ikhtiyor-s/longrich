import { Logger } from '@nestjs/common';

const logger = new Logger('AuthConfig');

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// DEV_ONLY_FALLBACKS exist purely so `development`/`test` can boot without a
// developer having to set every secret by hand — they are never acceptable
// outside those two NODE_ENV values. See requireSecret() below.
const DEV_ONLY_FALLBACKS: Record<string, string> = {
  JWT_SECRET: 'dev-only-insecure-jwt-secret',
  OTP_HMAC_SECRET: 'dev-only-insecure-otp-hmac-secret',
};

// Any environment this process boots in was silently running on these two
// literal, source-committed strings until this fix (QA G0 review blocker #2) —
// docker-compose.dev.yml and CI's e2e job never injected JWT_SECRET/
// OTP_HMAC_SECRET, so `?? 'dev-only-insecure-...'` was the value in use
// everywhere, dev and CI alike, with no signal that it was happening.
//
// requireSecret() now hard-fails startup for any unset/blank secret UNLESS
// NODE_ENV is explicitly 'development' or 'test' (default-assumed
// 'development' when NODE_ENV itself is unset, matching Node/Nest's own
// convention) — and even then it logs a loud warning so the fallback is never
// silent. A real deployment (NODE_ENV=production/staging/anything else) with
// a missing secret now fails to boot instead of starting insecurely.
function requireSecret(name: string): string {
  const raw = process.env[name];
  const value = raw && raw.trim().length > 0 ? raw : undefined;
  if (value) {
    return value;
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const allowFallback = nodeEnv === 'development' || nodeEnv === 'test';

  if (!allowFallback) {
    throw new Error(
      `${name} is not set. Refusing to start with an insecure default outside development/test (NODE_ENV="${nodeEnv}"). Set ${name} via the secret manager/environment before booting this service.`,
    );
  }

  const fallback = DEV_ONLY_FALLBACKS[name];
  if (!fallback) {
    throw new Error(`requireSecret: no DEV_ONLY_FALLBACKS entry registered for ${name}.`);
  }
  logger.warn(
    `${name} is not set; falling back to an INSECURE DEV-ONLY default because NODE_ENV="${nodeEnv}". This is never acceptable outside local development/test.`,
  );
  return fallback;
}

export interface AuthConfig {
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpHmacSecret: string;
  otpResendCooldownSeconds: number;
  otpRateLimitPerPhonePer15Min: number;
  otpRateLimitPerDevicePerHour: number;
  otpRateLimitPerIpPerHour: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  jwtSecret: string;
  jwtIssuer: string;
}

// TZ §28's OTP TTL / attempt-count defaults are explicitly flagged as "proposals," not
// confirmed business rules (see docs/architecture/g0-design-notes.md §1) — every value
// here is a configurable default, not a hardcoded contract guarantee.
export function loadAuthConfig(): AuthConfig {
  return {
    otpTtlSeconds: intEnv('OTP_TTL_SECONDS', 120),
    otpMaxAttempts: intEnv('OTP_MAX_ATTEMPTS', 5),
    otpHmacSecret: requireSecret('OTP_HMAC_SECRET'),
    otpResendCooldownSeconds: intEnv('OTP_RESEND_COOLDOWN_SECONDS', 60),
    otpRateLimitPerPhonePer15Min: intEnv('OTP_RATE_LIMIT_PHONE_15MIN', 5),
    otpRateLimitPerDevicePerHour: intEnv('OTP_RATE_LIMIT_DEVICE_HOUR', 10),
    otpRateLimitPerIpPerHour: intEnv('OTP_RATE_LIMIT_IP_HOUR', 20),
    accessTokenTtlSeconds: intEnv('ACCESS_TOKEN_TTL_SECONDS', 900),
    refreshTokenTtlDays: intEnv('REFRESH_TOKEN_TTL_DAYS', 30),
    jwtSecret: requireSecret('JWT_SECRET'),
    jwtIssuer: process.env.JWT_ISSUER ?? 'longrich-marketplace',
  };
}
