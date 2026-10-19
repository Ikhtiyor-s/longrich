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

export interface CatalogImportUploadConfig {
  allowedMimeTypes: string[];
  maxSizeBytes: number;
  maxRows: number;
}

// Same "config-driven, not a hardcoded business rule" pattern as
// sellers/documents/documents.config.ts (TZ names the requirement, not the
// exact limits). EXT-005's own "Super Admin controls: file limit ... rate
// limits" names an admin-configurable limit but no route in
// api-contract-g2.md ever wires an endpoint to change it at runtime — out of
// scope for this ticket (no acceptance line tests it), so these stay
// env-driven defaults rather than a DB-backed admin setting.
//
// Only `text/csv` is accepted for real parsing in this build — see
// csv-parser.ts's own comment for why XLSX (a binary OOXML/zip format) isn't
// hand-rolled here; widening this allowlist later only needs a real parser
// added alongside it, no schema/architecture change.
export function loadCatalogImportUploadConfig(): CatalogImportUploadConfig {
  return {
    allowedMimeTypes: listEnv('CATALOG_IMPORT_ALLOWED_MIME_TYPES', ['text/csv']),
    maxSizeBytes: intEnv('CATALOG_IMPORT_MAX_SIZE_BYTES', 10 * 1024 * 1024),
    maxRows: intEnv('CATALOG_IMPORT_MAX_ROWS', 10_000),
  };
}
