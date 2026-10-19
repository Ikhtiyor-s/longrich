import type { SellerDocument } from '@prisma/client';

export interface UploadPayload {
  uploadUrl: string;
  expiresInSeconds: number;
}

export function toDocumentPayload(document: SellerDocument, upload?: UploadPayload) {
  return {
    id: document.id,
    seller_id: document.sellerId,
    type: document.type,
    object_key: document.objectKey,
    filename: document.fileName,
    mime_type: document.mimeType,
    size_bytes: document.sizeBytes,
    verification_status: document.verificationStatus,
    scanned_at: document.scannedAt ? document.scannedAt.toISOString() : null,
    created_at: document.createdAt.toISOString(),
    updated_at: document.updatedAt.toISOString(),
    ...(upload
      ? { upload_url: upload.uploadUrl, upload_url_expires_in_seconds: upload.expiresInSeconds }
      : {}),
  };
}
