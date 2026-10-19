import { Injectable } from '@nestjs/common';
import { Prisma, type OfferStatus, type SellerOffer } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ForbiddenError, InvalidStateTransitionError, ValidationError } from '../../common/http/api-error';
import {
  CURSOR_KEYSET_ORDER_BY,
  cursorKeysetWhere,
  decodeCursor,
  paginate,
} from '../../common/pagination/cursor';
import type { AuthenticatedUser } from '../identity/auth/current-user.decorator';
import { VariantsService } from '../catalog/variants/variants.service';
import { SellersService } from '../sellers/sellers.service';
import { sellerRoleHasPermission } from '../sellers/members/seller-permissions';
import type { SellerOfferWithSeller } from './offer-access.guard';
import { PriceHistoryService } from './price-history/price-history.service';
import { parsePositivePriceMinor } from './price-minor';
import { toOfferPayload, toPublicOfferPayload } from './offers.mapper';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { ListSellerOffersQueryDto } from './dto/list-offers.query.dto';
import { ListVariantOffersQueryDto } from './dto/list-variant-offers.query.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

const DEFAULT_PAGE_LIMIT = 20;

// Seller self-service status toggle (PATCH body's optional `status` field)
// — a closed allow-list, not a free-form status write. DRAFT/PENDING_REVIEW/
// REJECTED are never a key here (unreachable as a *source* of this field,
// per api-contract-g2.md) and never appear as an allowed *target* either
// (only /submit or T-G2-7's moderator decisions reach PENDING_REVIEW/
// ACTIVE-from-PENDING_REVIEW/REJECTED).
const ALLOWED_SELF_SERVICE_STATUS_TRANSITIONS: Partial<Record<OfferStatus, OfferStatus[]>> = {
  ACTIVE: ['INACTIVE', 'SUSPENDED'],
  INACTIVE: ['ACTIVE', 'SUSPENDED'],
  SUSPENDED: ['INACTIVE'],
};

// DRAFT (first submit) or INACTIVE (resubmission after a T-G2-7
// "deactivate" moderation decision — the offer-side equivalent of
// products' DRAFT-or-CHANGES_REQUESTED-both-valid resubmit pattern).
const SUBMITTABLE_STATUSES: OfferStatus[] = ['DRAFT', 'INACTIVE'];

function duplicateSkuError(): ValidationError {
  return new ValidationError('An offer with this seller_sku already exists for this seller.', {
    seller_sku: ['already taken for this seller'],
  });
}

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly sellersService: SellersService,
    private readonly variantsService: VariantsService,
    private readonly priceHistoryService: PriceHistoryService,
  ) {}

  findById(id: string) {
    return this.prisma.sellerOffer.findUnique({ where: { id } });
  }

  // Two distinct 403 reasons on purpose, same split
  // MembersService/DocumentsService/ProfileService already use: no
  // membership at all is a cross-seller/spoofing denial (not audited as a
  // permission decision — the caller never had a role to check); a
  // membership that lacks seller:offers:manage is a real privilege denial,
  // audited as authz.permission_denied.
  private async requireOffersManagePermission(sellerId: string, actorId: string) {
    const membership = await this.sellersService.findMembership(sellerId, actorId);
    if (!membership) {
      throw new ForbiddenError('Caller is not a member of this seller.');
    }
    if (!sellerRoleHasPermission(membership.role, 'seller:offers:manage')) {
      await this.auditService.record({
        actor: { id: actorId, type: 'USER' },
        action: 'authz.permission_denied',
        entityType: 'seller_permission',
        entityId: 'seller:offers:manage',
        after: { seller_id: sellerId, caller_role: membership.role },
      });
      throw new ForbiddenError('Only a seller OWNER or MANAGER can manage offers.');
    }
    return membership;
  }

  private requireSellerActive(sellerStatus: string): void {
    if (sellerStatus !== 'ACTIVE') {
      throw new ForbiddenError('Seller cannot publish offers while not ACTIVE.', {
        status: [`seller.status is ${sellerStatus}, must be ACTIVE`],
      });
    }
  }

  // GET /v1/seller/offers?seller_id=... — membership-only (any role),
  // same shape as MembersController.list/DocumentsController.list: viewing
  // is broader than managing, no seller:offers:manage gate on read.
  async list(actor: AuthenticatedUser, sellerId: string, query: ListSellerOffersQueryDto) {
    const membership = await this.sellersService.findMembership(sellerId, actor.id);
    if (!membership) {
      throw new ForbiddenError('Caller is not a member of this seller.');
    }

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.prisma.sellerOffer.findMany({
      where: {
        sellerId,
        ...(query.status ? { status: query.status as OfferStatus } : {}),
        ...(cursorKeysetWhere(cursor) ?? {}),
      },
      orderBy: CURSOR_KEYSET_ORDER_BY,
      take: limit + 1,
    });

    const { items, nextCursor } = paginate(rows, limit);
    return { items: items.map(toOfferPayload), next_cursor: nextCursor };
  }

  // Trusts OfferAccessGuard + OwnershipGuard to have already authorized
  // this call (same trust boundary as DocumentsService.findOne) — no
  // duplicate membership check here.
  findOne(loaded: SellerOfferWithSeller) {
    return toOfferPayload(loaded);
  }

  async create(actor: AuthenticatedUser, dto: CreateOfferDto, requestContext: RequestContext) {
    await this.requireOffersManagePermission(dto.seller_id, actor.id);

    // seller_members.seller_id is FK-restricted to an existing sellers row
    // (prisma/schema.prisma), so a resolved membership above guarantees its
    // seller exists — same non-null assertion ProfileService.getProfile
    // already relies on for the same DB invariant, not an unchecked
    // assumption about caller input.
    const seller = (await this.sellersService.findById(dto.seller_id))!;
    this.requireSellerActive(seller.status);

    // Cross-module boundary rule (api-contract-g2.md): validated via
    // catalog's exported VariantsService.findPublishedOrThrow, never a
    // direct tx.productVariant.findUnique from inside this module.
    await this.variantsService.findPublishedOrThrow(dto.variant_id);

    const priceMinor = parsePositivePriceMinor(dto.price_minor);

    let created: SellerOffer;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const offer = await tx.sellerOffer.create({
          data: {
            sellerId: dto.seller_id,
            variantId: dto.variant_id,
            sku: dto.seller_sku,
            priceMinor,
            currency: dto.currency,
            fulfillmentMode: dto.fulfillment_mode,
          },
        });
        // Never clones products/product_variants rows — only reads the
        // variant above, writes only seller_offers + offer_price_history.
        await this.priceHistoryService.record(tx, {
          offerId: offer.id,
          oldPriceMinor: null,
          newPriceMinor: priceMinor,
          changedBy: actor.id,
        });
        return offer;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw duplicateSkuError();
      }
      throw error;
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_offer.created',
      entityType: 'seller_offer',
      entityId: created.id,
      after: {
        seller_id: created.sellerId,
        variant_id: created.variantId,
        price_minor: priceMinor.toString(),
      },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toOfferPayload(created);
  }

  // Trusts OfferAccessGuard + OwnershipGuard + SellerPermissionGuard to have
  // already authorized this call (same trust boundary as
  // MembersService.updateRole) — no duplicate permission check here.
  async update(
    actor: AuthenticatedUser,
    loaded: SellerOfferWithSeller,
    dto: UpdateOfferDto,
    requestContext: RequestContext,
  ) {
    // REJECTED is terminal (api-contract-g2.md "Out of scope": no
    // reactivate-after-REJECTED path) — blocks every field edit, not just
    // the status field.
    if (loaded.status === 'REJECTED') {
      throw new InvalidStateTransitionError(
        'This offer is REJECTED (terminal) and cannot be edited.',
      );
    }

    let nextStatus: OfferStatus = loaded.status;
    if (dto.status !== undefined) {
      const allowedTargets = ALLOWED_SELF_SERVICE_STATUS_TRANSITIONS[loaded.status] ?? [];
      if (!allowedTargets.includes(dto.status as OfferStatus)) {
        throw new InvalidStateTransitionError(
          `Offer status cannot transition from ${loaded.status} to ${dto.status} via this field.`,
        );
      }
      nextStatus = dto.status as OfferStatus;
    }

    let newPriceMinor: bigint | null = null;
    if (dto.price_minor !== undefined) {
      newPriceMinor = parsePositivePriceMinor(dto.price_minor);
    }
    const priceChanged = newPriceMinor !== null && newPriceMinor !== loaded.priceMinor;

    const data: Prisma.SellerOfferUncheckedUpdateManyInput = { status: nextStatus };
    if (dto.seller_sku !== undefined) data.sku = dto.seller_sku;
    if (newPriceMinor !== null) data.priceMinor = newPriceMinor;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.fulfillment_mode !== undefined) data.fulfillmentMode = dto.fulfillment_mode;

    let claim: { count: number };
    try {
      claim = await this.prisma.$transaction(async (tx) => {
        const result = await tx.sellerOffer.updateMany({
          where: { id: loaded.id, version: dto.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (result.count > 0 && priceChanged) {
          // Append-only: every actual price_minor change (old !== new)
          // writes one new immutable row, never an update to a prior row.
          await this.priceHistoryService.record(tx, {
            offerId: loaded.id,
            oldPriceMinor: loaded.priceMinor,
            newPriceMinor: newPriceMinor as bigint,
            changedBy: actor.id,
          });
        }
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw duplicateSkuError();
      }
      throw error;
    }

    if (claim.count === 0) {
      throw new InvalidStateTransitionError('Offer was modified by another request; reload and retry.');
    }

    const updated = await this.prisma.sellerOffer.findUniqueOrThrow({ where: { id: loaded.id } });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_offer.updated',
      entityType: 'seller_offer',
      entityId: loaded.id,
      before: { price_minor: loaded.priceMinor.toString(), status: loaded.status },
      after: { price_minor: updated.priceMinor.toString(), status: updated.status },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toOfferPayload(updated);
  }

  async submit(actor: AuthenticatedUser, loaded: SellerOfferWithSeller, requestContext: RequestContext) {
    // Re-checked here too — a seller could go SUSPENDED between creation
    // and submit (api-contract-g2.md).
    this.requireSellerActive(loaded.seller.status);

    const claim = await this.prisma.sellerOffer.updateMany({
      where: { id: loaded.id, status: { in: SUBMITTABLE_STATUSES } },
      data: { status: 'PENDING_REVIEW', version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new InvalidStateTransitionError('Offer is not in a submittable state.');
    }

    await this.prisma.moderationCase.create({
      data: { entityType: 'offer', entityId: loaded.id },
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_offer.submitted',
      entityType: 'seller_offer',
      entityId: loaded.id,
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    const updated = await this.prisma.sellerOffer.findUniqueOrThrow({ where: { id: loaded.id } });
    return toOfferPayload(updated);
  }

  // Cross-module boundary rule (api-contract-g2.md): T-G2-6's merge-case
  // approval writes to offers-owned data from catalog-module code only
  // through this exported method, called inside the *same*
  // prisma.$transaction callback that flips products.canonical_id
  // (ADR-001's "synchronous DI call inside one transaction boundary"
  // clause) — MergeCasesService never calls tx.sellerOffer.updateMany
  // itself. A plain `updateMany` across every offer on fromVariantId would
  // abort the whole statement if even one row collided with the
  // (seller_id, sku) unique constraint on toVariantId (the same seller
  // already has an offer there) — so each offer is moved individually,
  // leaving a colliding one pointed at the (still un-deleted) losing
  // variant rather than guessing a resolution for it.
  async repointVariantOwnership(
    tx: Prisma.TransactionClient,
    fromVariantId: string,
    toVariantId: string,
  ): Promise<{ movedCount: number; unmatchedCount: number }> {
    const offers = await tx.sellerOffer.findMany({ where: { variantId: fromVariantId } });

    let movedCount = 0;
    let unmatchedCount = 0;
    for (const offer of offers) {
      try {
        await tx.sellerOffer.update({ where: { id: offer.id }, data: { variantId: toVariantId } });
        movedCount += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          unmatchedCount += 1;
          continue;
        }
        throw error;
      }
    }
    return { movedCount, unmatchedCount };
  }

  // GET /v1/catalog/variants/{id}/offers (public) — lives in the offers
  // module despite its /v1/catalog/... URL prefix (api-contract-g2.md:
  // route path and owning module folder are independent). Both conditions
  // ("own status=ACTIVE" and "owning seller's status=ACTIVE") are enforced
  // in the query itself, never filtered client-side.
  async listPublicOffersForVariant(variantId: string, query: ListVariantOffersQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.prisma.sellerOffer.findMany({
      where: {
        variantId,
        status: 'ACTIVE',
        seller: { status: 'ACTIVE' },
        ...(cursorKeysetWhere(cursor) ?? {}),
      },
      orderBy: CURSOR_KEYSET_ORDER_BY,
      take: limit + 1,
    });

    const { items, nextCursor } = paginate(rows, limit);
    return { items: items.map(toPublicOfferPayload), next_cursor: nextCursor };
  }
}
