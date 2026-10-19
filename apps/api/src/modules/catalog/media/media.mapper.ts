import type { ProductMedia } from '@prisma/client';

export interface UploadPayload {
  uploadUrl: string;
  expiresInSeconds: number;
}

export function toMediaPayload(media: ProductMedia, upload?: UploadPayload) {
  return {
    id: media.id,
    product_id: media.productId,
    variant_id: media.variantId,
    object_key: media.objectKey,
    position: media.position,
    mime_type: media.mimeType,
    moderation_status: media.moderationStatus,
    created_at: media.createdAt.toISOString(),
    updated_at: media.updatedAt.toISOString(),
    version: media.version,
    ...(upload
      ? { upload_url: upload.uploadUrl, upload_url_expires_in_seconds: upload.expiresInSeconds }
      : {}),
  };
}
