function normalize(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Reasonable default deny-list per TZ §19 ("redact tokens, OTP, card, bank
// secrets"). Field names are matched case/separator-insensitively (normalize()
// strips non-alphanumerics), so "otp_code", "otpCode" and "OTP-CODE" all match
// a single "otpcode" entry here.
export const DEFAULT_SENSITIVE_FIELD_NAMES: readonly string[] = [
  'password',
  'otp_code',
  // Bare "code" is the actual wire field name OtpVerifyDto uses (`code`, not
  // `otp_code`) — see otp-verify.dto.ts. Generic on purpose and therefore a
  // deliberately broad match (would also redact a future "promo_code"/
  // "status_code"); accepted over-redaction tradeoff so the real OTP code can
  // never land in audit_logs unredacted.
  'code',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'otp_hmac_secret',
  'jwt_secret',
  'bank_account',
  'bank_account_number',
  'card_number',
  'cvv',
  'cvc',
  'pin',
  'authorization',
];

const REDACTED = '[REDACTED]';

function redactRecursive(value: unknown, sensitiveKeys: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactRecursive(item, sensitiveKeys));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sensitiveKeys.has(normalize(key))
        ? REDACTED
        : redactRecursive(val, sensitiveKeys);
    }
    return result;
  }

  return value;
}

// Deep-clones `value`, replacing the value of any object key whose normalized
// name is on the deny-list with a fixed "[REDACTED]" marker. Applied BEFORE
// persistence (AuditService.record), not just before logging — a redacted
// field's original value never reaches the database row.
export function redactSensitiveFields<T>(value: T, extraFieldNames: readonly string[] = []): T {
  const sensitiveKeys = new Set(
    [...DEFAULT_SENSITIVE_FIELD_NAMES, ...extraFieldNames].map(normalize),
  );
  return redactRecursive(value, sensitiveKeys) as T;
}
