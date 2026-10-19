import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CategoryAttributesService } from './category-attributes.service';
import { InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';

const ACTOR = { id: 'admin-1', sessionId: 'session-1' };
const CTX = { requestId: 'req-1', traceId: null };

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function buildService(overrides: { prisma?: Record<string, unknown> } = {}) {
  const prisma = overrides.prisma ?? {};
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const service = new CategoryAttributesService(prisma as never, auditService as never);
  return { service, prisma, auditService };
}

function attributeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attr-1',
    categoryId: 'cat-1',
    key: 'color',
    label: 'Color',
    type: 'ENUM',
    required: true,
    validation: { enum_values: ['red', 'blue'] },
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

describe('CategoryAttributesService', () => {
  describe('list', () => {
    it('throws NotFoundException when the category does not exist, without querying attributes', async () => {
      const findUniqueCategory = jest.fn().mockResolvedValue(null);
      const findMany = jest.fn();
      const { service } = buildService({
        prisma: { category: { findUnique: findUniqueCategory }, categoryAttribute: { findMany } },
      });

      await expect(service.list('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('returns a plain mapped array for a known category', async () => {
      const findUniqueCategory = jest.fn().mockResolvedValue({ id: 'cat-1' });
      const findMany = jest.fn().mockResolvedValue([attributeRow()]);
      const { service } = buildService({
        prisma: { category: { findUnique: findUniqueCategory }, categoryAttribute: { findMany } },
      });

      const result = await service.list('cat-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.key).toBe('color');
      expect(result[0]?.type).toBe('ENUM');
    });
  });

  describe('create', () => {
    it('creates a well-formed ENUM attribute and records an audit entry', async () => {
      const findUniqueCategory = jest.fn().mockResolvedValue({ id: 'cat-1' });
      const create = jest.fn().mockResolvedValue(attributeRow());
      const { service, auditService } = buildService({
        prisma: { category: { findUnique: findUniqueCategory }, categoryAttribute: { create } },
      });

      const result = await service.create(
        'cat-1',
        ACTOR,
        {
          key: 'color',
          label: 'Color',
          type: 'ENUM',
          required: true,
          validation: { enum_values: ['red', 'blue'] },
        },
        CTX,
      );
      expect(result.key).toBe('color');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'category_attribute.created' }),
      );
    });

    it('throws NotFoundException for an unknown category_id', async () => {
      const findUniqueCategory = jest.fn().mockResolvedValue(null);
      const create = jest.fn();
      const { service } = buildService({
        prisma: { category: { findUnique: findUniqueCategory }, categoryAttribute: { create } },
      });

      await expect(
        service.create('missing', ACTOR, { key: 'k', label: 'L', type: 'TEXT' }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects with 422 VALIDATION_ERROR on a malformed NUMERIC_RANGE validation shape, and never creates the row', async () => {
      const findUniqueCategory = jest.fn().mockResolvedValue({ id: 'cat-1' });
      const create = jest.fn();
      const { service } = buildService({
        prisma: { category: { findUnique: findUniqueCategory }, categoryAttribute: { create } },
      });

      await expect(
        service.create(
          'cat-1',
          ACTOR,
          {
            key: 'warranty',
            label: 'Warranty',
            type: 'NUMERIC_RANGE',
            validation: { min: 10, max: 5 },
          },
          CTX,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects with 422 VALIDATION_ERROR on a duplicate (category_id, key) (P2002)', async () => {
      const findUniqueCategory = jest.fn().mockResolvedValue({ id: 'cat-1' });
      const create = jest.fn().mockRejectedValue(p2002());
      const { service } = buildService({
        prisma: { category: { findUnique: findUniqueCategory }, categoryAttribute: { create } },
      });

      await expect(
        service.create('cat-1', ACTOR, { key: 'color', label: 'Color', type: 'TEXT' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('update', () => {
    it('updates via compare-and-swap on version, re-validating the existing type/validation shape', async () => {
      const loaded = attributeRow();
      const updated = attributeRow({ label: 'Primary Color', version: 2 });
      const findUnique = jest.fn().mockResolvedValue(loaded);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue(updated);
      const { service, auditService } = buildService({
        prisma: { categoryAttribute: { findUnique, updateMany, findUniqueOrThrow } },
      });

      const result = await service.update(
        'cat-1',
        'attr-1',
        ACTOR,
        { version: 1, label: 'Primary Color' },
        CTX,
      );
      expect(result.label).toBe('Primary Color');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'category_attribute.updated' }),
      );
    });

    it('throws NotFoundException when the attribute belongs to a different category', async () => {
      const findUnique = jest.fn().mockResolvedValue(attributeRow({ categoryId: 'other-cat' }));
      const { service } = buildService({ prisma: { categoryAttribute: { findUnique } } });

      await expect(
        service.update('cat-1', 'attr-1', ACTOR, { version: 1, label: 'X' }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with 409 INVALID_STATE_TRANSITION on a stale version', async () => {
      const findUnique = jest.fn().mockResolvedValue(attributeRow());
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const { service } = buildService({
        prisma: { categoryAttribute: { findUnique, updateMany } },
      });

      await expect(
        service.update('cat-1', 'attr-1', ACTOR, { version: 1, label: 'X' }, CTX),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    it('rejects with 422 VALIDATION_ERROR when switching type without a compatible validation payload', async () => {
      const findUnique = jest.fn().mockResolvedValue(attributeRow());
      const updateMany = jest.fn();
      const { service } = buildService({
        prisma: { categoryAttribute: { findUnique, updateMany } },
      });

      // Existing validation is {enum_values:[...]}; switching type to TEXT
      // without clearing it must fail (TEXT forbids any validation payload).
      await expect(
        service.update('cat-1', 'attr-1', ACTOR, { version: 1, type: 'TEXT' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('allows switching type together with a compatible validation payload in the same request', async () => {
      const loaded = attributeRow();
      const updated = attributeRow({ type: 'UNIT', validation: { unit: 'kg' }, version: 2 });
      const findUnique = jest.fn().mockResolvedValue(loaded);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue(updated);
      const { service } = buildService({
        prisma: { categoryAttribute: { findUnique, updateMany, findUniqueOrThrow } },
      });

      const result = await service.update(
        'cat-1',
        'attr-1',
        ACTOR,
        { version: 1, type: 'UNIT', validation: { unit: 'kg' } },
        CTX,
      );
      expect(result.type).toBe('UNIT');
    });
  });
});
