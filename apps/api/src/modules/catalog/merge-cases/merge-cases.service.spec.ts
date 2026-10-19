import { NotFoundException } from '@nestjs/common';
import { MergeCasesService } from './merge-cases.service';
import { InvalidStateTransitionError } from '../../../common/http/api-error';
import { encodeCursor } from '../../../common/pagination/cursor';

const ACTOR = { id: 'admin-1', sessionId: 'session-1' };
const CTX = { requestId: 'req-1', traceId: null };

function mergeCaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'merge-1',
    winningProductId: 'product-win',
    losingProductId: 'product-lose',
    identifierType: 'GTIN',
    identifierValue: '04006381333931',
    status: 'PENDING',
    manualResolutionRequired: false,
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function variantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'variant-1',
    productId: 'product-1',
    optionsHash: 'hash-a',
    status: 'PUBLISHED',
    ...overrides,
  };
}

function buildService(overrides: {
  prisma?: Record<string, unknown>;
  offersService?: Record<string, unknown>;
} = {}) {
  const prisma = overrides.prisma ?? {};
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const offersService = {
    repointVariantOwnership: jest.fn().mockResolvedValue({ movedCount: 0, unmatchedCount: 0 }),
    ...overrides.offersService,
  };
  const service = new MergeCasesService(prisma as never, auditService as never, offersService as never);
  return { service, prisma, auditService, offersService };
}

describe('MergeCasesService', () => {
  describe('list', () => {
    it('defaults to status=PENDING when no status filter is given', async () => {
      const findMany = jest.fn().mockResolvedValue([mergeCaseRow()]);
      const { service } = buildService({ prisma: { productMergeCase: { findMany } } });

      const result = await service.list({});
      expect(result.items).toHaveLength(1);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'PENDING' }) }),
      );
    });

    it('filters by an explicit status', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { service } = buildService({ prisma: { productMergeCase: { findMany } } });

      await service.list({ status: 'APPROVED' });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'APPROVED' }) }),
      );
    });

    it('emits a next_cursor when an extra row beyond the limit is fetched', async () => {
      const row1 = mergeCaseRow({ id: 'm1' });
      const row2 = mergeCaseRow({ id: 'm2', createdAt: new Date('2026-10-18T10:00:01.000Z') });
      const findMany = jest.fn().mockResolvedValue([row1, row2]);
      const { service } = buildService({ prisma: { productMergeCase: { findMany } } });

      const result = await service.list({ limit: 1 });
      expect(result.items).toHaveLength(1);
      expect(result.next_cursor).toBe(encodeCursor(row1));
    });
  });

  describe('findOne / findByIdOrThrow', () => {
    it('throws NotFoundException for an unknown id', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma: { productMergeCase: { findUnique } } });

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the mapped payload for a known id', async () => {
      const findUnique = jest.fn().mockResolvedValue(mergeCaseRow());
      const { service } = buildService({ prisma: { productMergeCase: { findUnique } } });

      const result = await service.findOne('merge-1');
      expect(result.winning_product_id).toBe('product-win');
      expect(result.losing_product_id).toBe('product-lose');
    });
  });

  describe('approve', () => {
    it('rejects with 409 INVALID_STATE_TRANSITION when the case is not PENDING', async () => {
      const loaded = mergeCaseRow({ status: 'APPROVED' });
      const { service } = buildService();

      await expect(service.approve(loaded as never, ACTOR, CTX)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('rejects with 409 INVALID_STATE_TRANSITION on a lost CAS race (stale version)', async () => {
      const loaded = mergeCaseRow();
      const mergeCaseUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
      const transaction = jest.fn((cb) =>
        cb({ productMergeCase: { updateMany: mergeCaseUpdateMany } }),
      );
      const { service } = buildService({ prisma: { $transaction: transaction } });

      await expect(service.approve(loaded as never, ACTOR, CTX)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('redirects canonical_id, repoints offers for every clean options_hash match, and leaves an unmatched variant untouched with manual_resolution_required=true', async () => {
      const loaded = mergeCaseRow();
      const losingVariants = [
        variantRow({ id: 'lv-1', optionsHash: 'hash-a' }),
        variantRow({ id: 'lv-2', optionsHash: 'hash-b' }),
        variantRow({ id: 'lv-3', optionsHash: 'hash-no-match' }),
      ];
      const winningVariants = [
        variantRow({ id: 'wv-1', optionsHash: 'hash-a' }),
        variantRow({ id: 'wv-2', optionsHash: 'hash-b' }),
      ];

      const mergeCaseUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const productUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const productVariantFindMany = jest
        .fn()
        .mockResolvedValueOnce(losingVariants)
        .mockResolvedValueOnce(winningVariants);
      const mergeCaseUpdate = jest
        .fn()
        .mockResolvedValue(mergeCaseRow({ status: 'APPROVED', manualResolutionRequired: true, version: 2 }));
      const moderationDecisionCreate = jest.fn().mockResolvedValue({ id: 'dec-1' });

      const tx = {
        productMergeCase: { updateMany: mergeCaseUpdateMany, update: mergeCaseUpdate },
        product: { updateMany: productUpdateMany },
        productVariant: { findMany: productVariantFindMany },
        moderationDecision: { create: moderationDecisionCreate },
      };
      const transaction = jest.fn((cb) => cb(tx));

      const repointVariantOwnership = jest
        .fn()
        .mockResolvedValueOnce({ movedCount: 2, unmatchedCount: 0 })
        .mockResolvedValueOnce({ movedCount: 1, unmatchedCount: 0 });

      const { service, auditService } = buildService({
        prisma: { $transaction: transaction },
        offersService: { repointVariantOwnership },
      });

      const result = await service.approve(loaded as never, ACTOR, CTX);

      expect(productUpdateMany).toHaveBeenCalledWith({
        where: { id: 'product-lose' },
        data: { canonicalId: 'product-win', version: { increment: 1 } },
      });
      expect(repointVariantOwnership).toHaveBeenCalledTimes(2);
      expect(repointVariantOwnership).toHaveBeenNthCalledWith(1, tx, 'lv-1', 'wv-1');
      expect(repointVariantOwnership).toHaveBeenNthCalledWith(2, tx, 'lv-2', 'wv-2');
      expect(mergeCaseUpdate).toHaveBeenCalledWith({
        where: { id: 'merge-1' },
        data: { manualResolutionRequired: true },
      });
      expect(result).toEqual({
        id: 'merge-1',
        status: 'APPROVED',
        manual_resolution_required: true,
        repointed_offer_count: 3,
        unmatched_variant_count: 1,
        unmatched_offer_count: 0,
        version: 2,
      });
      expect(moderationDecisionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'product_merge_case',
          entityId: 'merge-1',
          outcome: 'APPROVED',
          reason: null,
          decidedBy: 'admin-1',
        }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_merge_case.approved' }),
      );
    });

    it('sets manual_resolution_required=false and skips the extra update when every variant matches', async () => {
      const loaded = mergeCaseRow();
      const losingVariants = [variantRow({ id: 'lv-1', optionsHash: 'hash-a' })];
      const winningVariants = [variantRow({ id: 'wv-1', optionsHash: 'hash-a' })];

      const mergeCaseUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const productUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const productVariantFindMany = jest
        .fn()
        .mockResolvedValueOnce(losingVariants)
        .mockResolvedValueOnce(winningVariants);
      const mergeCaseFindUniqueOrThrow = jest
        .fn()
        .mockResolvedValue(mergeCaseRow({ status: 'APPROVED', version: 2 }));
      const mergeCaseUpdate = jest.fn();
      const moderationDecisionCreate = jest.fn().mockResolvedValue({ id: 'dec-1' });

      const tx = {
        productMergeCase: {
          updateMany: mergeCaseUpdateMany,
          update: mergeCaseUpdate,
          findUniqueOrThrow: mergeCaseFindUniqueOrThrow,
        },
        product: { updateMany: productUpdateMany },
        productVariant: { findMany: productVariantFindMany },
        moderationDecision: { create: moderationDecisionCreate },
      };
      const transaction = jest.fn((cb) => cb(tx));

      const repointVariantOwnership = jest.fn().mockResolvedValue({ movedCount: 1, unmatchedCount: 0 });

      const { service } = buildService({
        prisma: { $transaction: transaction },
        offersService: { repointVariantOwnership },
      });

      const result = await service.approve(loaded as never, ACTOR, CTX);
      expect(mergeCaseUpdate).not.toHaveBeenCalled();
      expect(result.manual_resolution_required).toBe(false);
      expect(result.unmatched_variant_count).toBe(0);
      expect(result.repointed_offer_count).toBe(1);
    });

    it('sets manual_resolution_required=true and surfaces unmatched_offer_count when every variant matches 1:1 but repointVariantOwnership reports a (seller_id, sku) offer collision', async () => {
      const loaded = mergeCaseRow();
      const losingVariants = [variantRow({ id: 'lv-1', optionsHash: 'hash-a' })];
      const winningVariants = [variantRow({ id: 'wv-1', optionsHash: 'hash-a' })];

      const mergeCaseUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const productUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const productVariantFindMany = jest
        .fn()
        .mockResolvedValueOnce(losingVariants)
        .mockResolvedValueOnce(winningVariants);
      const mergeCaseUpdate = jest
        .fn()
        .mockResolvedValue(mergeCaseRow({ status: 'APPROVED', manualResolutionRequired: true, version: 2 }));
      const moderationDecisionCreate = jest.fn().mockResolvedValue({ id: 'dec-1' });

      const tx = {
        productMergeCase: { updateMany: mergeCaseUpdateMany, update: mergeCaseUpdate },
        product: { updateMany: productUpdateMany },
        productVariant: { findMany: productVariantFindMany },
        moderationDecision: { create: moderationDecisionCreate },
      };
      const transaction = jest.fn((cb) => cb(tx));

      // The variant itself matched 1:1 (hash-a <-> hash-a), but
      // repointVariantOwnership still reports one stuck offer — this is the
      // exact case MAJOR 1 fixes: previously unmatchedCount was discarded,
      // so manual_resolution_required stayed false and the stuck offer was
      // invisible anywhere.
      const repointVariantOwnership = jest.fn().mockResolvedValueOnce({ movedCount: 1, unmatchedCount: 1 });

      const { service, auditService } = buildService({
        prisma: { $transaction: transaction },
        offersService: { repointVariantOwnership },
      });

      const result = await service.approve(loaded as never, ACTOR, CTX);

      expect(mergeCaseUpdate).toHaveBeenCalledWith({
        where: { id: 'merge-1' },
        data: { manualResolutionRequired: true },
      });
      expect(result).toEqual({
        id: 'merge-1',
        status: 'APPROVED',
        manual_resolution_required: true,
        repointed_offer_count: 1,
        unmatched_variant_count: 0,
        unmatched_offer_count: 1,
        version: 2,
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product_merge_case.approved',
          after: expect.objectContaining({
            unmatched_offer_count: 1,
            offer_collisions: [{ losing_variant_id: 'lv-1', winning_variant_id: 'wv-1', unmatched_offer_count: 1 }],
          }),
        }),
      );
    });
  });

  describe('reject', () => {
    it('rejects with 409 INVALID_STATE_TRANSITION when the case is not PENDING', async () => {
      const loaded = mergeCaseRow({ status: 'REJECTED' });
      const { service } = buildService();

      await expect(service.reject(loaded as never, ACTOR, 'Not the same product.', CTX)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('rejects with 409 INVALID_STATE_TRANSITION on a lost CAS race (stale version)', async () => {
      const loaded = mergeCaseRow();
      const mergeCaseUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
      const transaction = jest.fn((cb) =>
        cb({ productMergeCase: { updateMany: mergeCaseUpdateMany } }),
      );
      const { service } = buildService({ prisma: { $transaction: transaction } });

      await expect(
        service.reject(loaded as never, ACTOR, 'Not the same product.', CTX),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    it('sets status=REJECTED, writes a moderation_decisions row with the reason, and never touches canonical_id', async () => {
      const loaded = mergeCaseRow();
      const mergeCaseUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const moderationDecisionCreate = jest.fn().mockResolvedValue({ id: 'dec-1' });
      const mergeCaseFindUniqueOrThrow = jest
        .fn()
        .mockResolvedValue(mergeCaseRow({ status: 'REJECTED', version: 2 }));
      const tx = {
        productMergeCase: { updateMany: mergeCaseUpdateMany, findUniqueOrThrow: mergeCaseFindUniqueOrThrow },
        moderationDecision: { create: moderationDecisionCreate },
      };
      const transaction = jest.fn((cb) => cb(tx));

      const { service, auditService } = buildService({ prisma: { $transaction: transaction } });

      const result = await service.reject(loaded as never, ACTOR, 'Not the same product.', CTX);
      expect(result.status).toBe('REJECTED');
      expect(moderationDecisionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'product_merge_case',
          outcome: 'REJECTED',
          reason: 'Not the same product.',
          decidedBy: 'admin-1',
        }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_merge_case.rejected' }),
      );
    });
  });
});
