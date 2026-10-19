import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VariantsService } from './variants.service';
import { InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';
import { computeOptionsHash } from './options-hash';

const ACTOR = { id: 'admin-1', sessionId: 'session-1' };
const CTX = { requestId: 'req-1', traceId: null };

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function productRow(overrides: Record<string, unknown> = {}) {
  return { id: 'product-1', categoryId: 'category-1', status: 'DRAFT', ...overrides };
}

function variantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'variant-1',
    productId: 'product-1',
    options: { size: 'L', color: 'red' },
    optionsHash: computeOptionsHash({ size: 'L', color: 'red' }),
    status: 'DRAFT',
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    version: 1,
    attributeValues: [],
    media: [],
    ...overrides,
  };
}

function buildService(overrides: { prisma?: Record<string, unknown> } = {}) {
  const prisma = overrides.prisma ?? {};
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const service = new VariantsService(prisma as never, auditService as never);
  return { service, prisma, auditService };
}

describe('VariantsService', () => {
  describe('create', () => {
    it('creates a variant with attribute_values inside one transaction', async () => {
      const product = productRow();
      const variant = variantRow();
      const findUniqueProduct = jest.fn().mockResolvedValue(product);
      const findManyCategoryAttribute = jest.fn().mockResolvedValue([
        { id: 'attr-1', key: 'color', type: 'ENUM', validation: { enum_values: ['red', 'blue'] } },
      ]);
      const txProductVariantCreate = jest.fn().mockResolvedValue(variant);
      const txProductAttributeValueCreate = jest.fn().mockResolvedValue({});
      const transaction = jest.fn((cb) =>
        cb({
          productVariant: { create: txProductVariantCreate },
          productAttributeValue: { create: txProductAttributeValueCreate },
        }),
      );
      const findUniqueVariant = jest.fn().mockResolvedValue(variant);

      const { service, auditService } = buildService({
        prisma: {
          product: { findUnique: findUniqueProduct },
          categoryAttribute: { findMany: findManyCategoryAttribute },
          $transaction: transaction,
          productVariant: { findUnique: findUniqueVariant },
        },
      });

      const result = await service.create(
        'product-1',
        ACTOR,
        { options: { size: 'L', color: 'red' }, attribute_values: [{ category_attribute_id: 'attr-1', value: 'red' }] },
        CTX,
      );

      expect(result.options).toEqual({ size: 'L', color: 'red' });
      expect(txProductAttributeValueCreate).toHaveBeenCalledWith({
        data: { variantId: variant.id, categoryAttributeId: 'attr-1', value: 'red' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_variant.created' }),
      );
    });

    it('rejects an attribute value not matching its rule with 422 VALIDATION_ERROR', async () => {
      const product = productRow();
      const findUniqueProduct = jest.fn().mockResolvedValue(product);
      const findManyCategoryAttribute = jest.fn().mockResolvedValue([
        { id: 'attr-1', key: 'color', type: 'ENUM', validation: { enum_values: ['red', 'blue'] } },
      ]);
      const transaction = jest.fn();

      const { service } = buildService({
        prisma: {
          product: { findUnique: findUniqueProduct },
          categoryAttribute: { findMany: findManyCategoryAttribute },
          $transaction: transaction,
        },
      });

      await expect(
        service.create(
          'product-1',
          ACTOR,
          {
            options: { size: 'L' },
            attribute_values: [{ category_attribute_id: 'attr-1', value: 'green' }],
          },
          CTX,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects a duplicate (product_id, options_hash) with 422 VALIDATION_ERROR', async () => {
      const product = productRow();
      const findUniqueProduct = jest.fn().mockResolvedValue(product);
      const transaction = jest.fn().mockRejectedValue(p2002());

      const { service } = buildService({
        prisma: {
          product: { findUnique: findUniqueProduct },
          categoryAttribute: { findMany: jest.fn() },
          $transaction: transaction,
        },
      });

      await expect(
        service.create('product-1', ACTOR, { options: { size: 'L' } }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws NotFoundException for an unknown product_id', async () => {
      const findUniqueProduct = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma: { product: { findUnique: findUniqueProduct } } });

      await expect(
        service.create('missing', ACTOR, { options: { size: 'L' } }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates via compare-and-swap on version', async () => {
      const loaded = variantRow();
      const findUniqueVariant = jest.fn().mockResolvedValue(loaded);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const transaction = jest.fn((cb) => cb({ productVariant: { updateMany } }));

      const { service } = buildService({
        prisma: { productVariant: { findUnique: findUniqueVariant }, $transaction: transaction },
      });

      const result = await service.update('variant-1', ACTOR, { version: 1, options: { size: 'M' } }, CTX);
      expect(result.options).toEqual({ size: 'L', color: 'red' });
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'variant-1', version: 1 },
        data: {
          options: { size: 'M' },
          optionsHash: computeOptionsHash({ size: 'M' }),
          version: { increment: 1 },
        },
      });
    });

    it('rejects with 409 INVALID_STATE_TRANSITION on a stale version', async () => {
      const loaded = variantRow();
      const findUniqueVariant = jest.fn().mockResolvedValue(loaded);
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const transaction = jest.fn((cb) => cb({ productVariant: { updateMany } }));

      const { service } = buildService({
        prisma: { productVariant: { findUnique: findUniqueVariant }, $transaction: transaction },
      });

      await expect(
        service.update('variant-1', ACTOR, { version: 1, options: { size: 'M' } }, CTX),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });
  });

  describe('submit', () => {
    it('blocks with 422 and details.missing_attribute_keys when a required attribute has no value yet', async () => {
      const loaded = variantRow();
      const product = productRow();
      const findUniqueVariant = jest.fn().mockResolvedValue(loaded);
      const findUniqueProduct = jest.fn().mockResolvedValue(product);
      const findManyCategoryAttribute = jest.fn().mockResolvedValue([
        { id: 'attr-1', key: 'color', required: true },
      ]);
      const findManyAttributeValue = jest.fn().mockResolvedValue([]);
      const updateMany = jest.fn();

      const { service } = buildService({
        prisma: {
          productVariant: { findUnique: findUniqueVariant, updateMany },
          product: { findUnique: findUniqueProduct },
          categoryAttribute: { findMany: findManyCategoryAttribute },
          productAttributeValue: { findMany: findManyAttributeValue },
        },
      });

      const error = await service.submit('variant-1', ACTOR, CTX).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details.missing_attribute_keys).toEqual(['color']);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('transitions DRAFT -> PENDING_REVIEW and opens a moderation_cases row when all required attributes are present', async () => {
      const loaded = variantRow();
      const product = productRow();
      const findUniqueVariant = jest.fn().mockResolvedValue(loaded);
      const findUniqueProduct = jest.fn().mockResolvedValue(product);
      const findManyCategoryAttribute = jest.fn().mockResolvedValue([
        { id: 'attr-1', key: 'color', required: true },
      ]);
      const findManyAttributeValue = jest.fn().mockResolvedValue([{ categoryAttributeId: 'attr-1' }]);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const moderationCaseCreate = jest.fn().mockResolvedValue({ id: 'mc-1' });

      const { service, auditService } = buildService({
        prisma: {
          productVariant: { findUnique: findUniqueVariant, updateMany },
          product: { findUnique: findUniqueProduct },
          categoryAttribute: { findMany: findManyCategoryAttribute },
          productAttributeValue: { findMany: findManyAttributeValue },
          moderationCase: { create: moderationCaseCreate },
        },
      });

      const result = await service.submit('variant-1', ACTOR, CTX);
      expect(result.id).toBe('variant-1');
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'variant-1', status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
        data: { status: 'PENDING_REVIEW', version: { increment: 1 } },
      });
      expect(moderationCaseCreate).toHaveBeenCalledWith({
        data: { entityType: 'product_variant', entityId: 'variant-1' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_variant.submitted' }),
      );
    });

    it('rejects with 409 INVALID_STATE_TRANSITION when the variant is not DRAFT/CHANGES_REQUESTED', async () => {
      const loaded = variantRow({ status: 'PUBLISHED' });
      const product = productRow();
      const findUniqueVariant = jest.fn().mockResolvedValue(loaded);
      const findUniqueProduct = jest.fn().mockResolvedValue(product);
      const findManyCategoryAttribute = jest.fn().mockResolvedValue([]);
      const findManyAttributeValue = jest.fn().mockResolvedValue([]);
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });

      const { service } = buildService({
        prisma: {
          productVariant: { findUnique: findUniqueVariant, updateMany },
          product: { findUnique: findUniqueProduct },
          categoryAttribute: { findMany: findManyCategoryAttribute },
          productAttributeValue: { findMany: findManyAttributeValue },
        },
      });

      await expect(service.submit('variant-1', ACTOR, CTX)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });
  });

  describe('findPublishedOrThrow', () => {
    it('throws NotFoundException when the variant is not PUBLISHED', async () => {
      const findUnique = jest.fn().mockResolvedValue(variantRow({ status: 'DRAFT' }));
      const { service } = buildService({ prisma: { productVariant: { findUnique } } });

      await expect(service.findPublishedOrThrow('variant-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the variant when PUBLISHED', async () => {
      const findUnique = jest.fn().mockResolvedValue(variantRow({ status: 'PUBLISHED' }));
      const { service } = buildService({ prisma: { productVariant: { findUnique } } });

      const result = await service.findPublishedOrThrow('variant-1');
      expect(result.status).toBe('PUBLISHED');
    });
  });
});
