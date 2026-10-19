const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * Accepts already-valid E.164 input as-is; additionally normalizes common
 * Uzbek local-format inputs (bare 998-prefixed, 9-digit subscriber number,
 * or 0-prefixed trunk format) to +998 E.164. Returns null for anything that
 * cannot be normalized to a valid E.164 number.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/[\s()-]/g, '');
  if (trimmed.length === 0) return null;

  if (E164_PATTERN.test(trimmed)) {
    return trimmed;
  }
  if (/^998\d{9}$/.test(trimmed)) {
    return `+${trimmed}`;
  }
  if (/^0\d{9}$/.test(trimmed)) {
    return `+998${trimmed.slice(1)}`;
  }
  if (/^\d{9}$/.test(trimmed)) {
    return `+998${trimmed}`;
  }
  return null;
}

export function isValidE164(phone: string): boolean {
  return E164_PATTERN.test(phone);
}

export function maskPhone(phone: string): string {
  if (!phone.startsWith('+') || phone.length < 8) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}
