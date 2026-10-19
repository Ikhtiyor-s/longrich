import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProductMergeCase } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import {
  CURSOR_KEYSET_ORDER_BY,
  cursorKeysetWhere,
  decodeCursor,
  paginate,
} from '../../../common/pagination/cursor';
import { OffersService } from '../../offers/seller-offers.service';
import { toApproveResultPayload, toMergeCasePayload } from './merge-cases.mapper';
import { ListMergeCasesQueryDto } from './dto/list-merge-cases.query.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

const DEFAULT_PAGE_LIMIT = 20;
const DEFAULT_LIST_STATUS = 'PENDING';

@Injectable()
export class MergeCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly offersService: OffersService,
  ) {}

  async list(query: ListMergeCasesQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const status = query.status ?? DEFAULT_LIST_STATUS;

    const rows = await this.prisma.productMergeCase.findMany({
      where: {
        status,
        ...(cursorKeysetWhere(cursor) ?? {}),
      },
      orderBy: CURSOR_KEYSET_ORDER_BY,
      take: limit + 1,
    });

    const { items, nextCursor } = paginate(rows, limit);
    return { items: items.map(toMergeCasePayload), next_cursor: nextCursor };
  }

  async findByIdOrThrow(id: string): Promise<ProductMergeCase> {
    const mergeCase = await this.prisma.productMergeCase.findUnique({ where: { id } });
    if (!mergeCase) {
      throw new NotFoundException('Merge case not found.');
    }
    return mergeCase;
  }

  async findOne(id: string) {
    return toMergeCasePayload(await this.findByIdOrThrow(id));
  }

  // Approve effect (api-contract-g2.md, frozen verbatim by TZ §31), all in
  // one transaction:
  //   1. Claim the merge case via compare-and-swap on the version read in
  //      findByIdOrThrow above (same load-then-CAS-write idiom as
  //      ModerationService.decide) — a lost race (already decided, or a
  //      concurrent decision) is a 409, not a silent overwrite.
  //   2. Redirect the losing product's canonical_id to the winning product.
  //      The losing product/variant rows are never deleted.
  //   3. For every losing variant with a clean 1:1 options_hash match on the
  //      winning product, re-point its seller_offers via OffersService's
  //      exported repointVariantOwnership (cross-module DI call inside this
  //      same transaction, per the catalog<->offers boundary rule) — never
  //      a direct tx.sellerOffer.updateMany call from this module. Any
  //      losing variant without a match is left untouched and flips
  //      manual_resolution_required — never guessed.
  //   4. Write the moderation_decisions row (no moderation_cases row exists
  //      for merges).
  async approve(loaded: ProductMergeCase, actor: AuthenticatedUser, requestContext: RequestContext) {
    if (loaded.status !== 'PENDING') {
      throw new InvalidStateTransitionError(
        `Merge case cannot be approved while in status ${loaded.status}.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.productMergeCase.updateMany({
        where: { id: loaded.id, version: loaded.version, status: 'PENDING' },
        data: { status: 'APPROVED', version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new InvalidStateTransitionError(
          'Merge case was modified by another request; reload and retry.',
        );
      }

      await tx.product.updateMany({
        where: { id: loaded.losingProductId },
        data: { canonicalId: loaded.winningProductId, version: { increment: 1 } },
      });

      const [losingVariants, winningVariants] = await Promise.all([
        tx.productVariant.findMany({ where: { productId: loaded.losingProductId } }),
        tx.productVariant.findMany({ where: { productId: loaded.winningProductId } }),
      ]);
      const winningVariantByHash = new Map(winningVariants.map((v) => [v.optionsHash, v]));

      let repointedOfferCount = 0;
      let unmatchedVariantCount = 0;
      let unmatchedOfferCount = 0;
      const offerCollisions: Array<{
        losing_variant_id: string;
        winning_variant_id: string;
        unmatched_offer_count: number;
      }> = [];
      for (const losingVariant of losingVariants) {
        const match = winningVariantByHash.get(losingVariant.optionsHash);
        if (!match) {
          unmatchedVariantCount += 1;
          continue;
        }
        // The variant itself matched 1:1, but repointVariantOwnership can
        // still leave individual offers stuck on a per-offer (seller_id, sku)
        // collision against the winning variant (see its own comment) — that
        // unmatchedCount was previously discarded here, silently losing the
        // offer with zero record anywhere. Aggregated below into the same
        // manual_resolution_required signal as a variant-level mismatch,
        // and the losing/winning variant pair is recorded so the stuck
        // offer(s) are findable (queryable by variant_id) rather than only
        // known by count.
        const { movedCount, unmatchedCount } = await this.offersService.repointVariantOwnership(
          tx,
          losingVariant.id,
          match.id,
        );
        repointedOfferCount += movedCount;
        if (unmatchedCount > 0) {
          unmatchedOfferCount += unmatchedCount;
          offerCollisions.push({
            losing_variant_id: losingVariant.id,
            winning_variant_id: match.id,
            unmatched_offer_count: unmatchedCount,
          });
        }
      }

      const manualResolutionRequired = unmatchedVariantCount > 0 || unmatchedOfferCount > 0;
      const mergeCase = manualResolutionRequired
        ? await tx.productMergeCase.update({
            where: { id: loaded.id },
            data: { manualResolutionRequired: true },
          })
        : await tx.productMergeCase.findUniqueOrThrow({ where: { id: loaded.id } });

      await tx.moderationDecision.create({
        data: {
          entityType: 'product_merge_case',
          entityId: loaded.id,
          outcome: 'APPROVED',
          reason: null,
          decidedBy: actor.id,
          decidedAt: new Date(),
        },
      });

      return { mergeCase, repointedOfferCount, unmatchedVariantCount, unmatchedOfferCount, offerCollisions };
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product_merge_case.approved',
      entityType: 'product_merge_case',
      entityId: loaded.id,
      before: { status: loaded.status },
      after: {
        status: result.mergeCase.status,
        winning_product_id: loaded.winningProductId,
        losing_product_id: loaded.losingProductId,
        repointed_offer_count: result.repointedOfferCount,
        unmatched_variant_count: result.unmatchedVariantCount,
        unmatched_offer_count: result.unmatchedOfferCount,
        offer_collisions: result.offerCollisions,
      },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toApproveResultPayload(
      result.mergeCase,
      result.repointedOfferCount,
      result.unmatchedVariantCount,
      result.unmatchedOfferCount,
    );
  }

  // Reject: both products remain fully independent — canonical_id is never
  // touched. Same load-then-CAS-write idiom as approve().
  async reject(
    loaded: ProductMergeCase,
    actor: AuthenticatedUser,
    reason: string,
    requestContext: RequestContext,
  ) {
    if (loaded.status !== 'PENDING') {
      throw new InvalidStateTransitionError(
        `Merge case cannot be rejected while in status ${loaded.status}.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.productMergeCase.updateMany({
        where: { id: loaded.id, version: loaded.version, status: 'PENDING' },
        data: { status: 'REJECTED', version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new InvalidStateTransitionError(
          'Merge case was modified by another request; reload and retry.',
        );
      }

      await tx.moderationDecision.create({
        data: {
          entityType: 'product_merge_case',
          entityId: loaded.id,
          outcome: 'REJECTED',
          reason,
          decidedBy: actor.id,
          decidedAt: new Date(),
        },
      });

      return tx.productMergeCase.findUniqueOrThrow({ where: { id: loaded.id } });
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product_merge_case.rejected',
      entityType: 'product_merge_case',
      entityId: loaded.id,
      before: { status: loaded.status },
      after: { status: updated.status, reason },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toMergeCasePayload(updated);
  }
}
