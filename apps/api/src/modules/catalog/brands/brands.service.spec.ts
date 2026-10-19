import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BrandsService } from './brands.service';
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
  const service = new BrandsService(prisma as never, auditService as never);
  return { service, prisma, auditService };
}

function brandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'brand-1',
    name: 'Acme',
    slug: 'acme',
    logoObjectKey: null,
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

describe('BrandsService', () => {
  describe('list', () => {
    it('returns every brand mapped to the wire payload', async () => {
      const findMany = jest.fn().mockResolvedValue([brandRow()]);
      const { service } = buildService({ prisma: { brand: { findMany } } });

      const result = await service.list();
      expect(result).toHaveLength(1);
      expect(result[0]?.slug).toBe('acme');
    });
  });

  describe('findOne / findByIdOrThrow', () => {
    it('throws NotFoundException for an unknown id', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma: { brand: { findUnique } } });

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a brand and records an audit entry', async () => {
      const create = jest.fn().mockResolvedValue(brandRow());
      const { service, auditService } = buildService({ prisma: { brand: { create } } });

      const result = await service.create(ACTOR, { name: 'Acme', slug: 'acme' }, CTX);
      expect(result.name).toBe('Acme');
      expect(create).toHaveBeenCalledWith({
        data: { name: 'Acme', slug: 'acme', logoObjectKey: null },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'brand.created' }),
      );
    });

    it('rejects a duplicate name/slug (P2002) with 422 VALIDATION_ERROR', async () => {
      const create = jest.fn().mockRejectedValue(p2002());
      const { service } = buildService({ prisma: { brand: { create } } });

      await expect(service.create(ACTOR, { name: 'Acme', slug: 'acme' }, CTX)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe('update', () => {
    it('updates via compare-and-swap on version', async () => {
      const loaded = brandRow();
      const updated = brandRow({ name: 'Acme Corp', version: 2 });
      const findUnique = jest.fn().mockResolvedValue(loaded);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue(updated);
      const { service } = buildService({
        prisma: { brand: { findUnique, updateMany, findUniqueOrThrow } },
      });

      const result = await service.update('brand-1', ACTOR, { version: 1, name: 'Acme Corp' }, CTX);
      expect(result.name).toBe('Acme Corp');
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'brand-1', version: 1 },
        data: { name: 'Acme Corp', version: { increment: 1 } },
      });
    });

    it('rejects with 409 INVALID_STATE_TRANSITION on a stale version', async () => {
      const findUnique = jest.fn().mockResolvedValue(brandRow());
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const { service } = buildService({ prisma: { brand: { findUnique, updateMany } } });

      await expect(
        service.update('brand-1', ACTOR, { version: 1, name: 'New' }, CTX),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });
  });
});
