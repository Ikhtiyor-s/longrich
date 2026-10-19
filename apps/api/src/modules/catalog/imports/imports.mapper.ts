import type { CatalogImportError, CatalogImportJob } from '@prisma/client';

// api-contract-g2.md's GET /v1/seller/catalog/imports/{id} example shape —
// reused as-is for list items (no separate, smaller list-item shape is
// shown anywhere in the contract for this endpoint, unlike
// GET /v1/catalog/products's deliberately smaller list item).
export function toImportJobPayload(job: CatalogImportJob) {
  return {
    id: job.id,
    seller_id: job.sellerId,
    status: job.status,
    total_rows: job.totalRows,
    valid_row_count: job.validRowCount,
    error_row_count: job.errorRowCount,
    duplicate_of_job_id: job.duplicateOfJobId,
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
    version: job.version,
  };
}

export function toImportUploadPayload(
  job: CatalogImportJob,
  upload: { url: string; expiresInSeconds: number },
) {
  return {
    id: job.id,
    status: job.status,
    upload_url: upload.url,
    upload_url_expires_in_seconds: upload.expiresInSeconds,
  };
}

export function toImportErrorPayload(error: CatalogImportError) {
  return {
    row_number: error.rowNumber,
    field: error.field,
    message: error.message,
  };
}
