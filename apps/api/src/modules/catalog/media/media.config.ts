function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface ProductMediaUploadConfig {
  allowedMimeTypes: string[];
  maxSizeBytes: number;
}

// api-contract-g2.md's mime_type allowlist is fixed (images only — video
// explicitly out of scope, see "Out of scope"); max size has no stated
// business number, same "config default, not a frozen business rule"
// reasoning as loadSellerDocumentUploadConfig's own maxSizeBytes.
export function loadProductMediaUploadConfig(): ProductMediaUploadConfig {
  return {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSizeBytes: intEnv('CATALOG_MEDIA_MAX_SIZE_BYTES', 10 * 1024 * 1024),
  };
}
