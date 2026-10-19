import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdentifiersService } from './identifiers.service';
import { ValidationError } from '../../../common/http/api-error';

const ACTOR = { id: 'admin-1', sessionId: 'session-1' };
const CTX = { requestId: 'req-1', traceId: null };

const VALID_GTIN = '04006381333931';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function variantRow(overrides: Record<string, unknown> = {}) {
  return { id: 'variant-a', productId: 'product-a', status: 'DRAFT', ...overrides };
}

function productRow(overrides: Record<string, unknown> = {}) {
  return { id: 'product-a', createdAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides };
}

function identifierRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ident-1',
    variantId: 'variant-a',
    type: 'GTIN',
    value: VALID_GTIN,
    classificationVersion: null,
    createdBy: 'admin-1',
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    ...overrides,
  };
}

function buildService(overrides: { prisma?: Record<string, unknown> } = {}) {
  const prisma = overrides.prisma ?? {};
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const service = new IdentifiersService(prisma as never, auditService as never);
  return { service, prisma, auditService };
}

describe('IdentifiersService', () => {
  describe('create — checksum/classification_version validation', () => {
    it('rejects a GTIN with an invalid check digit with 422, never calling create', async () => {
      const findUnique = jest.fn().mockResolvedValue(variantRow());
      const create = jest.fn();
      const { service } = buildService({
        prisma: { productVariant: { findUnique }, productIdentifier: { create } },
      });

      await expect(
        service.create('variant-a', ACTOR, { type: 'GTIN', value: '04006381333930' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects non-numeric GTIN input with 422', async () => {
      const findUnique = jest.fn().mockResolvedValue(variantRow());
      const { service } = buildService({ prisma: { productVariant: { findUnique } } });

      await expect(
        service.create('variant-a', ACTOR, { type: 'GTIN', value: 'ABCDEFGH' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a wrong-length GTIN value with 422', async () => {
      const findUnique = jest.fn().mockResolvedValue(variantRow());
      const { service } = buildService({ prisma: { productVariant: { findUnique } } });

      await expect(
        service.create('variant-a', ACTOR, { type: 'GTIN', value: '123456789' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects MXIK with no classification_version with 422', async () => {
      const findUnique = jest.fn().mockResolvedValue(variantRow());
      const { service } = buildService({ prisma: { productVariant: { findUnique } } });

      await expect(
        service.create('variant-a', ACTOR, { type: 'MXIK', value: '01234567890123456' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws NotFoundException for an unknown variant id', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma: { productVariant: { findUnique } } });

      await expect(
        service.create('missing', ACTOR, { type: 'GTIN', value: VALID_GTIN }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create — success path', () => {
    it('creates a GTIN identifier and records an audit entry', async () => {
      const findUniqueVariant = jest.fn().mockResolvedValue(variantRow());
      const findFirstIdentifier = jest.fn().mockResolvedValue(null);
      const create = jest.fn().mockResolvedValue(identifierRow());
      const { service, auditService } = buildService({
        prisma: {
          productVariant: { findUnique: findUniqueVariant },
          productIdentifier: { findFirst: findFirstIdentifier, create },
        },
      });

      const result = await service.create('variant-a', ACTOR, { type: 'GTIN', value: VALID_GTIN }, CTX);
      expect(result).toEqual({
        id: 'ident-1',
        variant_id: 'variant-a',
        type: 'GTIN',
        value: VALID_GTIN,
        classification_version: null,
        created_at: '2026-10-18T10:00:00.000Z',
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          variantId: 'variant-a',
          type: 'GTIN',
          value: VALID_GTIN,
          classificationVersion: null,
          createdBy: 'admin-1',
        },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_identifier.created' }),
      );
    });

    it('stores classification_version for MXIK and never claims it is verified', async () => {
      const findUniqueVariant = jest.fn().mockResolvedValue(variantRow());
      const findFirstIdentifier = jest.fn().mockResolvedValue(null);
      const create = jest
        .fn()
        .mockResolvedValue(
          identifierRow({ type: 'MXIK', value: '01234567890123456', classificationVersion: '2024.3' }),
        );
      const { service } = buildService({
        prisma: {
          productVariant: { findUnique: findUniqueVariant },
          productIdentifier: { findFirst: findFirstIdentifier, create },
        },
      });

      const result = (await service.create(
        'variant-a',
        ACTOR,
        { type: 'MXIK', value: '01234567890123456', classification_version: '2024.3' },
        CTX,
      )) as { classification_version: string | null };
      expect(result.classification_version).toBe('2024.3');
      expect(result).not.toHaveProperty('verified');
    });

    it('re-posting the same (type, value) to the same variant is an idempotent no-op (no second row)', async () => {
      const existing = identifierRow();
      const findUniqueVariant = jest.fn().mockResolvedValue(variantRow());
      const findFirstIdentifier = jest.fn().mockResolvedValue(existing);
      const create = jest.fn();
      const { service } = buildService({
        prisma: {
          productVariant: { findUnique: findUniqueVariant },
          productIdentifier: { findFirst: findFirstIdentifier, create },
        },
      });

      const result = await service.create('variant-a', ACTOR, { type: 'GTIN', value: VALID_GTIN }, CTX);
      expect(result).toMatchObject({ id: 'ident-1', variant_id: 'variant-a' });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('create — cross-variant conflict path', () => {
    it('returns CONFLICT_DETECTED and creates one merge case, never attaching the identifier to the new variant', async () => {
      const existing = identifierRow({ variantId: 'variant-b' });
      const findUniqueVariant = jest.fn().mockResolvedValue(variantRow({ id: 'variant-a', productId: 'product-a' }));
      const findFirstIdentifier = jest.fn().mockResolvedValue(existing);
      const findUniqueOrThrowProduct = jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === 'product-a') {
            return Promise.resolve(productRow({ id: 'product-a', createdAt: new Date('2026-02-01T00:00:00.000Z') }));
          }
          return Promise.resolve(productRow({ id: 'product-b', createdAt: new Date('2026-01-01T00:00:00.000Z') }));
        });
      const findUniqueOrThrowVariant = jest.fn().mockResolvedValue(
        variantRow({ id: 'variant-b', productId: 'product-b' }),
      );
      const createIdentifier = jest.fn();
      const findUniqueMergeCase = jest.fn().mockResolvedValue(null);
      const createMergeCase = jest.fn().mockResolvedValue({ id: 'merge-1' });

      const { service, auditService } = buildService({
        prisma: {
          productVariant: { findUnique: findUniqueVariant, findUniqueOrThrow: findUniqueOrThrowVariant },
          product: { findUniqueOrThrow: findUniqueOrThrowProduct },
          productIdentifier: { findFirst: findFirstIdentifier, create: createIdentifier },
          productMergeCase: { findUnique: findUniqueMergeCase, create: createMergeCase },
        },
      });

      const result = await service.create('variant-a', ACTOR, { type: 'GTIN', value: VALID_GTIN }, CTX);

      expect(result).toEqual({
        status: 'CONFLICT_DETECTED',
        merge_case_id: 'merge-1',
        identifier_type: 'GTIN',
        identifier_value: VALID_GTIN,
      });
      expect(createIdentifier).not.toHaveBeenCalled();
      // product-b (earlier createdAt) wins over product-a.
      expect(createMergeCase).toHaveBeenCalledWith({
        data: {
          winningProductId: 'product-b',
          losingProductId: 'product-a',
          identifierType: 'GTIN',
          identifierValue: VALID_GTIN,
        },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_identifier.conflict_detected' }),
      );
    });

    it('reuses an existing merge case instead of creating a second one (idempotent on repeated detection)', async () => {
      const existing = identifierRow({ variantId: 'variant-b' });
      const findUniqueVariant = jest.fn().mockResolvedValue(variantRow({ id: 'variant-a', productId: 'product-a' }));
      const findFirstIdentifier = jest.fn().mockResolvedValue(existing);
      const findUniqueOrThrowProduct = jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(productRow({ id: where.id, createdAt: new Date('2026-01-01T00:00:00.000Z') })),
        );
      const findUniqueOrThrowVariant = jest.fn().mockResolvedValue(
        variantRow({ id: 'variant-b', productId: 'product-b' }),
      );
      const createMergeCase = jest.fn();
      const findUniqueMergeCase = jest.fn().mockResolvedValue({ id: 'merge-existing' });

      const { service } = buildService({
        prisma: {
          productVariant: { findUnique: findUniqueVariant, findUniqueOrThrow: findUniqueOrThrowVariant },
          product: { findUniqueOrThrow: findUniqueOrThrowProduct },
          productIdentifier: { findFirst: findFirstIdentifier },
          productMergeCase: { findUnique: findUniqueMergeCase, create: createMergeCase },
        },
      });

      const result = await service.create('variant-a', ACTOR, { type: 'GTIN', value: VALID_GTIN }, CTX);
      expect(result).toMatchObject({ status: 'CONFLICT_DETECTED', merge_case_id: 'merge-existing' });
      expect(createMergeCase).not.toHaveBeenCalled();
    });

    it('recovers from a P2002 race on merge-case create by refetching the winning row', async () => {
      const existing = identifierRow({ variantId: 'variant-b' });
      const findUniqueVariant = jest.fn().mockResolvedValue(variantRow({ id: 'variant-a', productId: 'product-a' }));
      const findFirstIdentifier = jest.fn().mockResolvedValue(existing);
      const findUniqueOrThrowProduct = jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(productRow({ id: where.id, createdAt: new Date('2026-01-01T00:00:00.000Z') })),
        );
      const findUniqueOrThrowVariant = jest.fn().mockResolvedValue(
        variantRow({ id: 'variant-b', productId: 'product-b' }),
      );
      const findUniqueMergeCase = jest.fn().mockResolvedValue(null);
      const createMergeCase = jest.fn().mockRejectedValue(p2002());
      const findUniqueOrThrowMergeCase = jest.fn().mockResolvedValue({ id: 'merge-raced' });

      const { service } = buildService({
        prisma: {
          productVariant: { findUnique: findUniqueVariant, findUniqueOrThrow: findUniqueOrThrowVariant },
          product: { findUniqueOrThrow: findUniqueOrThrowProduct },
          productIdentifier: { findFirst: findFirstIdentifier },
          productMergeCase: {
            findUnique: findUniqueMergeCase,
            create: createMergeCase,
            findUniqueOrThrow: findUniqueOrThrowMergeCase,
          },
        },
      });

      const result = await service.create('variant-a', ACTOR, { type: 'GTIN', value: VALID_GTIN }, CTX);
      expect(result).toMatchObject({ status: 'CONFLICT_DETECTED', merge_case_id: 'merge-raced' });
    });
  });

  describe('listPublic', () => {
    it('throws NotFoundException for an unknown variant id', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma: { productVariant: { findUnique } } });

      await expect(service.listPublic('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns an empty array for a variant that is not PUBLISHED', async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValue({ ...variantRow({ status: 'DRAFT' }), product: { status: 'PUBLISHED' } });
      const findMany = jest.fn();
      const { service } = buildService({
        prisma: { productVariant: { findUnique }, productIdentifier: { findMany } },
      });

      const result = await service.listPublic('variant-a');
      expect(result).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('returns an empty array when the variant is PUBLISHED but its product is not', async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValue({ ...variantRow({ status: 'PUBLISHED' }), product: { status: 'DRAFT' } });
      const { service } = buildService({ prisma: { productVariant: { findUnique } } });

      const result = await service.listPublic('variant-a');
      expect(result).toEqual([]);
    });

    it('returns mapped identifiers for a PUBLISHED variant with a PUBLISHED product', async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValue({ ...variantRow({ status: 'PUBLISHED' }), product: { status: 'PUBLISHED' } });
      const findMany = jest.fn().mockResolvedValue([identifierRow()]);
      const { service } = buildService({
        prisma: { productVariant: { findUnique }, productIdentifier: { findMany } },
      });

      const result = await service.listPublic('variant-a');
      expect(result).toEqual([{ type: 'GTIN', value: VALID_GTIN, classification_version: null }]);
    });
  });

  describe('findByTypeValue', () => {
    it('delegates to a (type, value) lookup', async () => {
      const findFirst = jest.fn().mockResolvedValue(identifierRow());
      const { service } = buildService({ prisma: { productIdentifier: { findFirst } } });

      const result = await service.findByTypeValue('GTIN', VALID_GTIN);
      expect(findFirst).toHaveBeenCalledWith({ where: { type: 'GTIN', value: VALID_GTIN } });
      expect(result?.id).toBe('ident-1');
    });
  });
});
