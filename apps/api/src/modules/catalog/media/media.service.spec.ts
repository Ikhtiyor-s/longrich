import { NotFoundException } from '@nestjs/common';
import { MediaService } from './media.service';
import { ValidationError } from '../../../common/http/api-error';

const ACTOR = { id: 'admin-1', sessionId: 'session-1' };
const CTX = { requestId: 'req-1', traceId: null };

function mediaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'media-1',
    productId: 'product-1',
    variantId: null,
    objectKey: 'catalog-media/product-1/abc-logo.png',
    position: 0,
    mimeType: 'image/png',
    moderationStatus: 'PENDING',
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function buildService(overrides: {
  prisma?: Record<string, unknown>;
  storageService?: Record<string, unknown>;
  scanAdapter?: { scan: jest.Mock };
} = {}) {
  const prisma = overrides.prisma ?? {};
  const storageService = overrides.storageService ?? {
    createPresignedUploadUrl: jest.fn().mockResolvedValue({ url: 'https://upload', expiresInSeconds: 900 }),
  };
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const scanAdapter = overrides.scanAdapter ?? { scan: jest.fn().mockResolvedValue({ clean: true, scannedAt: new Date() }) };
  const service = new MediaService(
    prisma as never,
    storageService as never,
    auditService as never,
    scanAdapter as never,
  );
  return { service, prisma, storageService, auditService, scanAdapter };
}

describe('MediaService', () => {
  describe('create', () => {
    it('creates a PENDING media row and returns an upload url', async () => {
      const findUniqueProduct = jest.fn().mockResolvedValue({ id: 'product-1' });
      const findFirstMedia = jest.fn().mockResolvedValue(null);
      const create = jest.fn().mockResolvedValue(mediaRow());
      const { service, auditService } = buildService({
        prisma: {
          product: { findUnique: findUniqueProduct },
          productMedia: { findFirst: findFirstMedia, create },
        },
      });

      const result = await service.create(
        'product-1',
        ACTOR,
        { filename: 'logo.png', mime_type: 'image/png', size_bytes: 1024, variant_id: null },
        CTX,
      );

      expect(result.upload_url).toBe('https://upload');
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productId: 'product-1', position: 0, mimeType: 'image/png' }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_media.upload_requested' }),
      );
    });

    it('rejects a disallowed mime_type with 422 VALIDATION_ERROR', async () => {
      const findUniqueProduct = jest.fn().mockResolvedValue({ id: 'product-1' });
      const { service } = buildService({
        prisma: { product: { findUnique: findUniqueProduct } },
      });

      await expect(
        service.create(
          'product-1',
          ACTOR,
          { filename: 'video.mp4', mime_type: 'video/mp4', size_bytes: 1024, variant_id: null },
          CTX,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws NotFoundException for an unknown product id', async () => {
      const findUniqueProduct = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma: { product: { findUnique: findUniqueProduct } } });

      await expect(
        service.create(
          'missing',
          ACTOR,
          { filename: 'logo.png', mime_type: 'image/png', size_bytes: 1024, variant_id: null },
          CTX,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('confirm', () => {
    it('keeps moderation_status PENDING and opens exactly one moderation_cases row on a clean scan', async () => {
      const loaded = mediaRow();
      const findUniqueMedia = jest.fn().mockResolvedValue(loaded);
      const findFirstCase = jest.fn().mockResolvedValue(null);
      const createCase = jest.fn().mockResolvedValue({ id: 'mc-1' });
      const { service, auditService } = buildService({
        prisma: {
          productMedia: { findUnique: findUniqueMedia },
          moderationCase: { findFirst: findFirstCase, create: createCase },
        },
      });

      const result = await service.confirm('media-1', ACTOR, CTX);
      expect(result.moderation_status).toBe('PENDING');
      expect(createCase).toHaveBeenCalledWith({
        data: { entityType: 'product_media', entityId: 'media-1' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_media.scan_clean' }),
      );
    });

    it('does not open a second moderation_cases row on a repeat confirm call', async () => {
      const loaded = mediaRow();
      const findUniqueMedia = jest.fn().mockResolvedValue(loaded);
      const findFirstCase = jest.fn().mockResolvedValue({ id: 'mc-1' });
      const createCase = jest.fn();
      const { service } = buildService({
        prisma: {
          productMedia: { findUnique: findUniqueMedia },
          moderationCase: { findFirst: findFirstCase, create: createCase },
        },
      });

      await service.confirm('media-1', ACTOR, CTX);
      expect(createCase).not.toHaveBeenCalled();
    });

    it('rejects outright on a dirty scan (REJECTED, never enters the human queue)', async () => {
      const loaded = mediaRow();
      const findUniqueMedia = jest.fn().mockResolvedValue(loaded);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue(mediaRow({ moderationStatus: 'REJECTED' }));
      const scanAdapter = { scan: jest.fn().mockResolvedValue({ clean: false, scannedAt: new Date() }) };
      const { service, auditService } = buildService({
        prisma: { productMedia: { findUnique: findUniqueMedia, updateMany, findUniqueOrThrow } },
        scanAdapter,
      });

      const result = await service.confirm('media-1', ACTOR, CTX);
      expect(result.moderation_status).toBe('REJECTED');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_media.scan_rejected' }),
      );
    });

    it('is idempotent on an already-decided media row (no re-scan)', async () => {
      const loaded = mediaRow({ moderationStatus: 'REJECTED' });
      const findUniqueMedia = jest.fn().mockResolvedValue(loaded);
      const scanAdapter = { scan: jest.fn() };
      const { service } = buildService({
        prisma: { productMedia: { findUnique: findUniqueMedia } },
        scanAdapter,
      });

      const result = await service.confirm('media-1', ACTOR, CTX);
      expect(result.moderation_status).toBe('REJECTED');
      expect(scanAdapter.scan).not.toHaveBeenCalled();
    });
  });
});
