function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : fallback;
}

export interface SellerDocumentUploadConfig {
  allowedMimeTypes: string[];
  maxSizeBytes: number;
}

// TZ §28: "docs signed upload with file MIME+size validation" names the
// requirement, not the exact allowed list/limit (see this ticket's own
// "Done means" text) — both are config-driven defaults, not a hardcoded,
// unchangeable business rule.
export function loadSellerDocumentUploadConfig(): SellerDocumentUploadConfig {
  return {
    allowedMimeTypes: listEnv('SELLER_DOCUMENT_ALLOWED_MIME_TYPES', [
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]),
    maxSizeBytes: intEnv('SELLER_DOCUMENT_MAX_SIZE_BYTES', 10 * 1024 * 1024),
  };
}
