import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';

const ACTOR = { id: 'admin-1', sessionId: 'session-1' };
const CTX = { requestId: 'req-1', traceId: null };

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    categoryId: 'category-1',
    brandId: null,
    title: 'Wireless Mouse',
    description: null,
    status: 'DRAFT',
    canonicalId: null,
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return { ...productRow(), brand: null, variants: [], media: [], ...overrides };
}

function buildService(overrides: { prisma?: Record<string, unknown> } = {}) {
  const prisma = overrides.prisma ?? {};
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const service = new ProductsService(prisma as never, auditService as never);
  return { service, prisma, auditService };
}

function basePrisma(overrides: Record<string, unknown> = {}) {
  return {
    category: { findUnique: jest.fn().mockResolvedValue({ id: 'category-1' }) },
    brand: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-1' }) },
    moderationDecision: { findFirst: jest.fn().mockResolvedValue(null) },
    product: {
      findUnique: jest.fn().mockResolvedValue(detailRow()),
    },
    ...overrides,
  };
}

describe('ProductsService', () => {
  describe('findOne (public detail)', () => {
    it('queries status=PUBLISHED and an APPROVED-only media filter (both product-level and variant-level)', async () => {
      const findFirst = jest.fn().mockResolvedValue(detailRow());
      const prisma = basePrisma({ product: { findFirst } });
      const { service } = buildService({ prisma });

      await service.findOne('product-1');

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'product-1', status: 'PUBLISHED' },
          include: expect.objectContaining({
            media: expect.objectContaining({ where: { moderationStatus: 'APPROVED' } }),
            variants: expect.objectContaining({
              include: expect.objectContaining({
                media: expect.objectContaining({ where: { moderationStatus: 'APPROVED' } }),
              }),
            }),
          }),
        }),
      );
    });

    it('throws NotFoundException for a DRAFT/unpublished product (never leaks it publicly)', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const prisma = basePrisma({ product: { findFirst } });
      const { service } = buildService({ prisma });

      await expect(service.findOne('draft-product')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for a well-formed but non-existent id', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const prisma = basePrisma({ product: { findFirst } });
      const { service } = buildService({ prisma });

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('sanitizes the description and creates a DRAFT product', async () => {
      const create = jest.fn().mockResolvedValue(productRow());
      const product = basePrisma({
        product: { findUnique: jest.fn().mockResolvedValue(detailRow()), create },
      });
      const { service, auditService } = buildService({ prisma: product });

      const result = await service.create(
        ACTOR,
        { category_id: 'category-1', title: 'Wireless Mouse', description: '<b>great</b> mouse' },
        CTX,
      );

      expect(create).toHaveBeenCalledWith({
        data: {
          categoryId: 'category-1',
          brandId: null,
          title: 'Wireless Mouse',
          description: 'great mouse',
        },
      });
      expect(result.status).toBe('DRAFT');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product.created' }),
      );
    });

    it('rejects an unknown category_id with 422 VALIDATION_ERROR', async () => {
      const prisma = basePrisma({ category: { findUnique: jest.fn().mockResolvedValue(null) } });
      const { service } = buildService({ prisma });

      await expect(
        service.create(ACTOR, { category_id: 'missing', title: 'X' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an unknown brand_id with 422 VALIDATION_ERROR', async () => {
      const prisma = basePrisma({ brand: { findUnique: jest.fn().mockResolvedValue(null) } });
      const { service } = buildService({ prisma });

      await expect(
        service.create(ACTOR, { category_id: 'category-1', brand_id: 'missing', title: 'X' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('update', () => {
    it('updates via compare-and-swap on version', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUnique = jest
        .fn()
        .mockResolvedValueOnce(productRow())
        .mockResolvedValue(detailRow({ title: 'Renamed' }));
      const prisma = basePrisma({ product: { findUnique, updateMany } });
      const { service } = buildService({ prisma });

      const result = await service.update('product-1', ACTOR, { version: 1, title: 'Renamed' }, CTX);
      expect(result.title).toBe('Renamed');
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'product-1', version: 1, status: { notIn: ['REJECTED', 'ARCHIVED'] } },
        data: { title: 'Renamed', version: { increment: 1 } },
      });
    });

    it('rejects with 409 INVALID_STATE_TRANSITION on a stale version or terminal status', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const findUnique = jest.fn().mockResolvedValue(productRow());
      const prisma = basePrisma({ product: { findUnique, updateMany } });
      const { service } = buildService({ prisma });

      await expect(
        service.update('product-1', ACTOR, { version: 1, title: 'X' }, CTX),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });
  });

  describe('submit', () => {
    it('transitions DRAFT -> PENDING_REVIEW and opens a moderation_cases row', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUnique = jest
        .fn()
        .mockResolvedValueOnce(productRow())
        .mockResolvedValue(detailRow());
      const moderationCaseCreate = jest.fn().mockResolvedValue({ id: 'mc-1' });
      const prisma = basePrisma({
        product: { findUnique, updateMany },
        moderationCase: { create: moderationCaseCreate },
      });
      const { service, auditService } = buildService({ prisma });

      const result = await service.submit('product-1', ACTOR, CTX);
      expect(result.id).toBe('product-1');
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'product-1', status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
        data: { status: 'PENDING_REVIEW', version: { increment: 1 } },
      });
      expect(moderationCaseCreate).toHaveBeenCalledWith({
        data: { entityType: 'product', entityId: 'product-1' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product.submitted' }),
      );
    });

    it('throws NotFoundException for an unknown id before attempting the transition', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const updateMany = jest.fn();
      const prisma = basePrisma({ product: { findUnique, updateMany } });
      const { service } = buildService({ prisma });

      await expect(service.submit('missing', ACTOR, CTX)).rejects.toBeInstanceOf(NotFoundException);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('rejects with 409 INVALID_STATE_TRANSITION when not currently DRAFT/CHANGES_REQUESTED', async () => {
      const findUnique = jest.fn().mockResolvedValue(productRow({ status: 'PUBLISHED' }));
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = basePrisma({ product: { findUnique, updateMany } });
      const { service } = buildService({ prisma });

      await expect(service.submit('product-1', ACTOR, CTX)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });
  });
});
