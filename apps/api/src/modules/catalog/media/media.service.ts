import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProductMedia } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../../common/storage/storage.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ValidationError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import {
  MALWARE_SCAN_ADAPTER,
  type MalwareScanAdapter,
} from '../../sellers/documents/malware-scan.adapter';
import { loadProductMediaUploadConfig } from './media.config';
import { toMediaPayload } from './media.mapper';
import { CreateMediaDto } from './dto/create-media.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

function sanitizeFilenameSegment(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-128);
}

function buildObjectKey(productId: string, filename: string): string {
  return `catalog-media/${productId}/${randomUUID()}-${sanitizeFilenameSegment(filename)}`;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    @Inject(MALWARE_SCAN_ADAPTER) private readonly scanAdapter: MalwareScanAdapter,
  ) {}

  private assertUploadAllowed(mimeType: string, sizeBytes: number): void {
    const config = loadProductMediaUploadConfig();
    const details: Record<string, string[]> = {};

    if (!config.allowedMimeTypes.includes(mimeType)) {
      details.mime_type = [
        `mime_type "${mimeType}" is not allowed. Allowed types: ${config.allowedMimeTypes.join(', ')}.`,
      ];
    }
    if (sizeBytes > config.maxSizeBytes) {
      details.size_bytes = [
        `size_bytes exceeds the maximum allowed size of ${config.maxSizeBytes} bytes.`,
      ];
    }

    if (Object.keys(details).length > 0) {
      throw new ValidationError('Product media upload rejected.', details);
    }
  }

  async create(productId: string, actor: AuthenticatedUser, dto: CreateMediaDto, requestContext: RequestContext) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    if (dto.variant_id) {
      const variant = await this.prisma.productVariant.findUnique({ where: { id: dto.variant_id } });
      if (!variant || variant.productId !== productId) {
        throw new ValidationError('variant_id does not belong to this product.', {
          variant_id: ['unknown variant id for this product'],
        });
      }
    }

    this.assertUploadAllowed(dto.mime_type, dto.size_bytes);

    const lastMedia = await this.prisma.productMedia.findFirst({
      where: { productId, variantId: dto.variant_id ?? null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = lastMedia ? lastMedia.position + 1 : 0;

    const objectKey = buildObjectKey(productId, dto.filename);
    const upload = await this.storageService.createPresignedUploadUrl(objectKey, dto.mime_type);

    const media = await this.prisma.productMedia.create({
      data: {
        productId,
        variantId: dto.variant_id ?? null,
        objectKey,
        position,
        mimeType: dto.mime_type,
      },
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product_media.upload_requested',
      entityType: 'product_media',
      entityId: media.id,
      after: { product_id: productId, variant_id: media.variantId, object_key: media.objectKey },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toMediaPayload(media, { uploadUrl: upload.url, expiresInSeconds: upload.expiresInSeconds });
  }

  private async findByIdOrThrow(id: string): Promise<ProductMedia> {
    const media = await this.prisma.productMedia.findUnique({ where: { id } });
    if (!media) {
      throw new NotFoundException('Media not found.');
    }
    return media;
  }

  async confirm(id: string, actor: AuthenticatedUser, requestContext: RequestContext) {
    const loaded = await this.findByIdOrThrow(id);

    // Already decided (REJECTED by a dirty scan, or APPROVED/REJECTED by a
    // future T-G2-7 human decision) — idempotent no-op, same shape as
    // SellerDocument's confirm() early return.
    if (loaded.moderationStatus !== 'PENDING') {
      return toMediaPayload(loaded);
    }

    const result = await this.scanAdapter.scan(loaded.objectKey, loaded.mimeType);

    if (!result.clean) {
      const claim = await this.prisma.productMedia.updateMany({
        where: { id, moderationStatus: 'PENDING' },
        data: { moderationStatus: 'REJECTED', version: { increment: 1 } },
      });
      const updated = await this.prisma.productMedia.findUniqueOrThrow({ where: { id } });
      if (claim.count === 0) {
        return toMediaPayload(updated);
      }

      await this.auditService.record({
        actor: { id: actor.id, type: 'USER' },
        action: 'product_media.scan_rejected',
        entityType: 'product_media',
        entityId: id,
        before: { moderation_status: 'PENDING' },
        after: { moderation_status: 'REJECTED' },
        requestId: requestContext.requestId,
        traceId: requestContext.traceId,
      });

      return toMediaPayload(updated);
    }

    // Clean scan: moderation_status stays PENDING (human moderation,
    // T-G2-7). moderation_cases has no CAS/version column of its own
    // (api-contract-g2.md), so the existence of a case row for this entity
    // is the idempotency guard against opening a second queue entry on a
    // repeat confirm call.
    const existingCase = await this.prisma.moderationCase.findFirst({
      where: { entityType: 'product_media', entityId: id },
    });
    if (!existingCase) {
      await this.prisma.moderationCase.create({
        data: { entityType: 'product_media', entityId: id },
      });
      await this.auditService.record({
        actor: { id: actor.id, type: 'USER' },
        action: 'product_media.scan_clean',
        entityType: 'product_media',
        entityId: id,
        requestId: requestContext.requestId,
        traceId: requestContext.traceId,
      });
    }

    return toMediaPayload(loaded);
  }
}
