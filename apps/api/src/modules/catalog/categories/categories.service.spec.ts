import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CategoriesService } from './categories.service';
import { InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';
import { encodeCursor } from '../../../common/pagination/cursor';

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
  const service = new CategoriesService(prisma as never, auditService as never);
  return { service, prisma, auditService };
}

function categoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat-1',
    parentId: null,
    slug: 'electronics',
    name: 'Electronics',
    status: 'ACTIVE',
    requiresCertification: false,
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

describe('CategoriesService', () => {
  describe('list', () => {
    it('returns items mapped to the wire payload and null next_cursor when within limit', async () => {
      const rows = [categoryRow()];
      const findMany = jest.fn().mockResolvedValue(rows);
      const { service } = buildService({ prisma: { category: { findMany } } });

      const result = await service.list({});
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.slug).toBe('electronics');
      expect(result.next_cursor).toBeNull();
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 21, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      );
    });

    it('filters by parent_id when provided', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { service } = buildService({ prisma: { category: { findMany } } });

      await service.list({ parent_id: 'parent-1' });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ parentId: 'parent-1' }) }),
      );
    });

    it('rejects a malformed cursor with 422 VALIDATION_ERROR before querying', async () => {
      const findMany = jest.fn();
      const { service } = buildService({ prisma: { category: { findMany } } });

      await expect(service.list({ cursor: 'not-valid' })).rejects.toBeInstanceOf(ValidationError);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('emits a next_cursor when an extra row beyond the limit is fetched', async () => {
      const row1 = categoryRow({ id: 'c1' });
      const row2 = categoryRow({ id: 'c2', createdAt: new Date('2026-10-18T10:00:01.000Z') });
      const findMany = jest.fn().mockResolvedValue([row1, row2]);
      const { service } = buildService({ prisma: { category: { findMany } } });

      const result = await service.list({ limit: 1 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('c1');
      expect(result.next_cursor).toBe(encodeCursor(row1));
    });
  });

  describe('findOne / findByIdOrThrow', () => {
    it('throws NotFoundException for an unknown id', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma: { category: { findUnique } } });

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the mapped payload for a known id', async () => {
      const findUnique = jest.fn().mockResolvedValue(categoryRow());
      const { service } = buildService({ prisma: { category: { findUnique } } });

      const result = await service.findOne('cat-1');
      expect(result.slug).toBe('electronics');
    });
  });

  describe('create', () => {
    it('creates a root category and records an audit entry', async () => {
      const create = jest.fn().mockResolvedValue(categoryRow());
      const { service, auditService } = buildService({ prisma: { category: { create } } });

      const result = await service.create(ACTOR, { slug: 'electronics', name: 'Electronics' }, CTX);
      expect(result.slug).toBe('electronics');
      expect(create).toHaveBeenCalledWith({
        data: {
          parentId: null,
          slug: 'electronics',
          name: 'Electronics',
          requiresCertification: false,
        },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'category.created' }),
      );
    });

    it('rejects with 422 VALIDATION_ERROR on an unknown parent_id', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const create = jest.fn();
      const { service } = buildService({ prisma: { category: { findUnique, create } } });

      await expect(
        service.create(ACTOR, { parent_id: 'missing-parent', slug: 'x', name: 'X' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects with 422 VALIDATION_ERROR on a duplicate slug (P2002), and no row is created', async () => {
      const create = jest.fn().mockRejectedValue(p2002());
      const { service } = buildService({ prisma: { category: { create } } });

      await expect(
        service.create(ACTOR, { slug: 'electronics', name: 'Electronics' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('update', () => {
    it('updates via compare-and-swap on version and records before/after in the audit log', async () => {
      const loaded = categoryRow();
      const updated = categoryRow({ name: 'Electronics & Gadgets', version: 2 });
      const findUnique = jest.fn().mockResolvedValue(loaded);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue(updated);
      const { service, auditService } = buildService({
        prisma: { category: { findUnique, updateMany, findUniqueOrThrow } },
      });

      const result = await service.update(
        'cat-1',
        ACTOR,
        { version: 1, name: 'Electronics & Gadgets' },
        CTX,
      );
      expect(result.name).toBe('Electronics & Gadgets');
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'cat-1', version: 1 },
        data: { name: 'Electronics & Gadgets', version: { increment: 1 } },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'category.updated' }),
      );
    });

    it('rejects with 409 INVALID_STATE_TRANSITION on a stale version (lost the CAS)', async () => {
      const findUnique = jest.fn().mockResolvedValue(categoryRow());
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const { service } = buildService({ prisma: { category: { findUnique, updateMany } } });

      await expect(
        service.update('cat-1', ACTOR, { version: 1, name: 'New Name' }, CTX),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    it('rejects with 422 VALIDATION_ERROR when parent_id is the category itself', async () => {
      const findUnique = jest.fn().mockResolvedValue(categoryRow());
      const updateMany = jest.fn();
      const { service } = buildService({ prisma: { category: { findUnique, updateMany } } });

      await expect(
        service.update('cat-1', ACTOR, { version: 1, parent_id: 'cat-1' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('rejects with 422 VALIDATION_ERROR on an unknown parent_id', async () => {
      const findUnique = jest.fn().mockResolvedValueOnce(categoryRow()).mockResolvedValueOnce(null);
      const updateMany = jest.fn();
      const { service } = buildService({ prisma: { category: { findUnique, updateMany } } });

      await expect(
        service.update('cat-1', ACTOR, { version: 1, parent_id: 'missing' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(updateMany).not.toHaveBeenCalled();
    });

    // Given/When/Then from docs/architecture/api-contract-g2.md verbatim:
    // category A has category B as its parent (A.parentId = B.id); PATCH
    // B's parent_id = A.id must be rejected as a cycle, with B.parentId left
    // unchanged (updateMany never called).
    it('rejects with 422 VALIDATION_ERROR on a cycle, and never calls updateMany', async () => {
      const store: Record<string, ReturnType<typeof categoryRow>> = {
        'cat-a': categoryRow({ id: 'cat-a', slug: 'a', parentId: 'cat-b' }),
        'cat-b': categoryRow({ id: 'cat-b', slug: 'b', parentId: null }),
      };
      const findUnique = jest.fn(
        ({ where, select }: { where: { id: string }; select?: { parentId: boolean } }) => {
          const row = store[where.id];
          if (!row) return Promise.resolve(null);
          if (select?.parentId) return Promise.resolve({ parentId: row.parentId });
          return Promise.resolve(row);
        },
      );
      const updateMany = jest.fn();
      const { service } = buildService({ prisma: { category: { findUnique, updateMany } } });

      await expect(
        service.update('cat-b', ACTOR, { version: 1, parent_id: 'cat-a' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('allows clearing parent_id to null (promote to root)', async () => {
      const loaded = categoryRow({ parentId: 'old-parent' });
      const updated = categoryRow({ parentId: null, version: 2 });
      const findUnique = jest.fn().mockResolvedValue(loaded);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue(updated);
      const { service } = buildService({
        prisma: { category: { findUnique, updateMany, findUniqueOrThrow } },
      });

      const result = await service.update('cat-1', ACTOR, { version: 1, parent_id: null }, CTX);
      expect(result.parent_id).toBeNull();
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'cat-1', version: 1 },
        data: { parentId: null, version: { increment: 1 } },
      });
    });
  });
});
