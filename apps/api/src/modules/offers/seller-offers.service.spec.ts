import { Prisma } from '@prisma/client';
import { OffersService } from './seller-offers.service';
import { ForbiddenError, InvalidStateTransitionError, ValidationError } from '../../common/http/api-error';

const ACTOR = { id: 'user-1', sessionId: 'session-1' };
const CTX = { requestId: 'req-1', traceId: null };

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    sellerId: 'seller-1',
    variantId: 'variant-1',
    sku: 'SKU-001',
    priceMinor: 4500000n,
    currency: 'UZS',
    fulfillmentMode: 'SELLER_WAREHOUSE',
    status: 'DRAFT',
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    version: 1,
    seller: { id: 'seller-1', status: 'ACTIVE' },
    ...overrides,
  };
}

function buildService(overrides: {
  prisma?: Record<string, unknown>;
  sellersService?: Record<string, unknown>;
  variantsService?: Record<string, unknown>;
} = {}) {
  const prisma = overrides.prisma ?? {};
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const sellersService = {
    findMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    findById: jest.fn().mockResolvedValue({ id: 'seller-1', status: 'ACTIVE' }),
    ...overrides.sellersService,
  };
  const variantsService = {
    findPublishedOrThrow: jest.fn().mockResolvedValue({ id: 'variant-1', status: 'PUBLISHED' }),
    ...overrides.variantsService,
  };
  const priceHistoryService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new OffersService(
    prisma as never,
    auditService as never,
    sellersService as never,
    variantsService as never,
    priceHistoryService as never,
  );
  return { service, prisma, auditService, sellersService, variantsService, priceHistoryService };
}

describe('OffersService', () => {
  describe('create', () => {
    const dto = {
      seller_id: 'seller-1',
      variant_id: 'variant-1',
      seller_sku: 'SKU-001',
      price_minor: '4500000',
      currency: 'UZS',
      fulfillment_mode: 'SELLER_WAREHOUSE',
    };

    it('creates a DRAFT offer and writes one offer_price_history row (old=null) in the same transaction, never touching products/product_variants', async () => {
      const created = offerRow();
      const txSellerOfferCreate = jest.fn().mockResolvedValue(created);
      const transaction = jest.fn((cb) => cb({ sellerOffer: { create: txSellerOfferCreate } }));

      const { service, priceHistoryService, auditService, variantsService } = buildService({
        prisma: { $transaction: transaction },
      });

      const result = await service.create(ACTOR, dto, CTX);

      expect(result.status).toBe('DRAFT');
      expect(result.price_minor).toBe('4500000');
      expect(result.seller_sku).toBe('SKU-001');
      expect(variantsService.findPublishedOrThrow).toHaveBeenCalledWith('variant-1');
      expect(txSellerOfferCreate).toHaveBeenCalledWith({
        data: {
          sellerId: 'seller-1',
          variantId: 'variant-1',
          sku: 'SKU-001',
          priceMinor: 4500000n,
          currency: 'UZS',
          fulfillmentMode: 'SELLER_WAREHOUSE',
        },
      });
      expect(priceHistoryService.record).toHaveBeenCalledWith(
        expect.anything(),
        { offerId: 'offer-1', oldPriceMinor: null, newPriceMinor: 4500000n, changedBy: 'user-1' },
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'seller_offer.created' }),
      );
    });

    it('rejects with 403 FORBIDDEN when the caller is not a member of the seller', async () => {
      const { service } = buildService({
        sellersService: { findMembership: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.create(ACTOR, dto, CTX)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('rejects with 403 FORBIDDEN when the caller role lacks seller:offers:manage (OPERATOR)', async () => {
      const { service } = buildService({
        sellersService: { findMembership: jest.fn().mockResolvedValue({ role: 'OPERATOR' }) },
      });

      await expect(service.create(ACTOR, dto, CTX)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('rejects with 403 FORBIDDEN when the owning seller is not ACTIVE', async () => {
      const { service } = buildService({
        sellersService: { findById: jest.fn().mockResolvedValue({ id: 'seller-1', status: 'DRAFT' }) },
      });

      await expect(service.create(ACTOR, dto, CTX)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('rejects with 404 NOT_FOUND (via VariantsService) when the variant is not PUBLISHED', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      const { service } = buildService({
        variantsService: {
          findPublishedOrThrow: jest.fn().mockRejectedValue(new NotFoundException('Variant not found.')),
        },
      });

      await expect(service.create(ACTOR, dto, CTX)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with 422 VALIDATION_ERROR on a non-positive price_minor, before any write', async () => {
      const transaction = jest.fn();
      const { service } = buildService({ prisma: { $transaction: transaction } });

      await expect(
        service.create(ACTOR, { ...dto, price_minor: '0' }, CTX),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects with 422 VALIDATION_ERROR and details.seller_sku on a duplicate (seller_id, sku)', async () => {
      const transaction = jest.fn().mockRejectedValue(p2002());
      const { service } = buildService({ prisma: { $transaction: transaction } });

      const error = await service.create(ACTOR, dto, CTX).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details.seller_sku).toBeDefined();
    });
  });

  describe('update', () => {
    it('updates price via compare-and-swap and writes exactly one new offer_price_history row when price actually changes', async () => {
      const loaded = offerRow();
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const transaction = jest.fn((cb) => cb({ sellerOffer: { updateMany } }));
      const findUniqueOrThrow = jest.fn().mockResolvedValue(offerRow({ priceMinor: 5000000n, version: 2 }));

      const { service, priceHistoryService } = buildService({
        prisma: { $transaction: transaction, sellerOffer: { findUniqueOrThrow } },
      });

      const result = await service.update(ACTOR, loaded as never, { version: 1, price_minor: '5000000' }, CTX);

      expect(result.price_minor).toBe('5000000');
      expect(priceHistoryService.record).toHaveBeenCalledWith(expect.anything(), {
        offerId: 'offer-1',
        oldPriceMinor: 4500000n,
        newPriceMinor: 5000000n,
        changedBy: 'user-1',
      });
    });

    it('does not write a price_history row when price_minor is unchanged', async () => {
      const loaded = offerRow();
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const transaction = jest.fn((cb) => cb({ sellerOffer: { updateMany } }));
      const findUniqueOrThrow = jest.fn().mockResolvedValue(offerRow());

      const { service, priceHistoryService } = buildService({
        prisma: { $transaction: transaction, sellerOffer: { findUniqueOrThrow } },
      });

      await service.update(ACTOR, loaded as never, { version: 1, price_minor: '4500000' }, CTX);
      expect(priceHistoryService.record).not.toHaveBeenCalled();
    });

    it('rejects with 409 INVALID_STATE_TRANSITION on a stale version', async () => {
      const loaded = offerRow();
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const transaction = jest.fn((cb) => cb({ sellerOffer: { updateMany } }));

      const { service } = buildService({ prisma: { $transaction: transaction } });

      await expect(
        service.update(ACTOR, loaded as never, { version: 99, price_minor: '5000000' }, CTX),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    it('rejects with 409 INVALID_STATE_TRANSITION when editing a REJECTED (terminal) offer', async () => {
      const loaded = offerRow({ status: 'REJECTED' });
      const { service } = buildService();

      await expect(
        service.update(ACTOR, loaded as never, { version: 1, price_minor: '5000000' }, CTX),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    it.each([
      ['ACTIVE', 'INACTIVE'],
      ['ACTIVE', 'SUSPENDED'],
      ['INACTIVE', 'ACTIVE'],
      ['INACTIVE', 'SUSPENDED'],
      ['SUSPENDED', 'INACTIVE'],
    ])('allows the self-service status transition %s -> %s', async (from, to) => {
      const loaded = offerRow({ status: from });
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const transaction = jest.fn((cb) => cb({ sellerOffer: { updateMany } }));
      const findUniqueOrThrow = jest.fn().mockResolvedValue(offerRow({ status: to }));

      const { service } = buildService({
        prisma: { $transaction: transaction, sellerOffer: { findUniqueOrThrow } },
      });

      const result = await service.update(ACTOR, loaded as never, { version: 1, status: to as never }, CTX);
      expect(result.status).toBe(to);
    });

    it.each([
      ['DRAFT', 'PENDING_REVIEW'],
      ['ACTIVE', 'DRAFT'],
      ['SUSPENDED', 'ACTIVE'],
      ['INACTIVE', 'REJECTED'],
    ])('rejects the disallowed self-service status transition %s -> %s with 409', async (from, to) => {
      const loaded = offerRow({ status: from });
      const { service } = buildService();

      await expect(
        service.update(ACTOR, loaded as never, { version: 1, status: to as never }, CTX),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });
  });

  describe('submit', () => {
    it('transitions DRAFT -> PENDING_REVIEW and opens a moderation_cases row', async () => {
      const loaded = offerRow();
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const moderationCaseCreate = jest.fn().mockResolvedValue({ id: 'mc-1' });
      const findUniqueOrThrow = jest.fn().mockResolvedValue(offerRow({ status: 'PENDING_REVIEW' }));

      const { service } = buildService({
        prisma: {
          sellerOffer: { updateMany, findUniqueOrThrow },
          moderationCase: { create: moderationCaseCreate },
        },
      });

      const result = await service.submit(ACTOR, loaded as never, CTX);
      expect(result.status).toBe('PENDING_REVIEW');
      expect(moderationCaseCreate).toHaveBeenCalledWith({ data: { entityType: 'offer', entityId: 'offer-1' } });
    });

    it('rejects with 403 FORBIDDEN when the owning seller is not ACTIVE (re-checked at submit time)', async () => {
      const loaded = offerRow({ seller: { id: 'seller-1', status: 'SUSPENDED' } });
      const { service } = buildService();

      await expect(service.submit(ACTOR, loaded as never, CTX)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('rejects with 409 INVALID_STATE_TRANSITION when the offer is already PENDING_REVIEW', async () => {
      const loaded = offerRow({ status: 'PENDING_REVIEW' });
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });

      const { service } = buildService({ prisma: { sellerOffer: { updateMany } } });

      await expect(service.submit(ACTOR, loaded as never, CTX)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });
  });

  describe('list', () => {
    it('rejects with 403 FORBIDDEN when the caller is not a member of the queried seller', async () => {
      const { service } = buildService({
        sellersService: { findMembership: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.list(ACTOR, 'seller-1', {})).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('returns a cursor page scoped to the given seller_id', async () => {
      const rows = [offerRow()];
      const findMany = jest.fn().mockResolvedValue(rows);
      const { service } = buildService({ prisma: { sellerOffer: { findMany } } });

      const result = await service.list(ACTOR, 'seller-1', {});
      expect(result.items).toHaveLength(1);
      expect(result.next_cursor).toBeNull();
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ sellerId: 'seller-1' }) }),
      );
    });
  });

  describe('repointVariantOwnership', () => {
    it('moves every offer on fromVariantId to toVariantId and reports movedCount', async () => {
      const update = jest.fn().mockResolvedValue(offerRow());
      const findMany = jest.fn().mockResolvedValue([offerRow({ id: 'offer-1' }), offerRow({ id: 'offer-2' })]);
      const tx = { sellerOffer: { findMany, update } };
      const { service } = buildService();

      const result = await service.repointVariantOwnership(tx as never, 'variant-losing', 'variant-winning');

      expect(result).toEqual({ movedCount: 2, unmatchedCount: 0 });
      expect(findMany).toHaveBeenCalledWith({ where: { variantId: 'variant-losing' } });
      expect(update).toHaveBeenNthCalledWith(1, {
        where: { id: 'offer-1' },
        data: { variantId: 'variant-winning' },
      });
      expect(update).toHaveBeenNthCalledWith(2, {
        where: { id: 'offer-2' },
        data: { variantId: 'variant-winning' },
      });
    });

    it('leaves a (seller_id, sku)-colliding offer unmoved (P2002) and reports it as unmatched, without blocking the rest', async () => {
      const update = jest
        .fn()
        .mockResolvedValueOnce(offerRow({ id: 'offer-1' }))
        .mockRejectedValueOnce(p2002())
        .mockResolvedValueOnce(offerRow({ id: 'offer-3' }));
      const findMany = jest
        .fn()
        .mockResolvedValue([
          offerRow({ id: 'offer-1' }),
          offerRow({ id: 'offer-2' }),
          offerRow({ id: 'offer-3' }),
        ]);
      const tx = { sellerOffer: { findMany, update } };
      const { service } = buildService();

      const result = await service.repointVariantOwnership(tx as never, 'variant-losing', 'variant-winning');

      expect(result).toEqual({ movedCount: 2, unmatchedCount: 1 });
      expect(update).toHaveBeenCalledTimes(3);
    });

    it('returns zero counts when the losing variant has no offers', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const update = jest.fn();
      const tx = { sellerOffer: { findMany, update } };
      const { service } = buildService();

      const result = await service.repointVariantOwnership(tx as never, 'variant-losing', 'variant-winning');
      expect(result).toEqual({ movedCount: 0, unmatchedCount: 0 });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('listPublicOffersForVariant', () => {
    it('queries only status=ACTIVE offers whose seller is also ACTIVE', async () => {
      const findMany = jest.fn().mockResolvedValue([offerRow({ status: 'ACTIVE' })]);
      const { service } = buildService({ prisma: { sellerOffer: { findMany } } });

      const result = await service.listPublicOffersForVariant('variant-1', {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: 'offer-1',
        seller_id: 'seller-1',
        seller_sku: 'SKU-001',
        price_minor: '4500000',
        currency: 'UZS',
        fulfillment_mode: 'SELLER_WAREHOUSE',
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            variantId: 'variant-1',
            status: 'ACTIVE',
            seller: { status: 'ACTIVE' },
          }),
        }),
      );
    });
  });
});
