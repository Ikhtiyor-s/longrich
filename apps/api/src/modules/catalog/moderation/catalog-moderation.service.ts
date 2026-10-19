import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
import { toMediaPayload } from '../media/media.mapper';
import { toVariantPayload, type VariantWithRelations } from '../variants/variants.mapper';
import { ProductsService } from '../products/products.service';
import { toModerationQueueItemPayload } from './catalog-moderation.mapper';
import { ApproveDecisionDto } from './dto/approve-decision.dto';
import { DecisionReasonDto } from './dto/decision-reason.dto';
import { ListModerationQueueQueryDto } from './dto/list-moderation-queue.query.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

const DEFAULT_PAGE_LIMIT = 20;

const VARIANT_RELATIONS_INCLUDE = {
  attributeValues: { include: { categoryAttribute: true } },
  media: { orderBy: { position: 'asc' as const } },
};

type ProductVariantOutcome = 'PUBLISHED' | 'CHANGES_REQUESTED' | 'REJECTED';
type MediaOutcome = 'APPROVED' | 'REJECTED';

@Injectable()
export class CatalogModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly productsService: ProductsService,
  ) {}

  async listQueue(query: ListModerationQueueQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.prisma.moderationCase.findMany({
      where: {
        status: 'OPEN',
        ...(query.entity_type ? { entityType: query.entity_type } : {}),
        ...(cursorKeysetWhere(cursor) ?? {}),
      },
      orderBy: CURSOR_KEYSET_ORDER_BY,
      take: limit + 1,
    });

    const { items, nextCursor } = paginate(rows, limit);
    return { items: items.map(toModerationQueueItemPayload), next_cursor: nextCursor };
  }

  // Resolves the OPEN moderation_cases row for this entity (if any — none
  // exists if a decision is somehow made without a prior submit, which no
  // endpoint in this ticket allows) and writes the immutable
  // moderation_decisions row, inside the caller's own CAS transaction.
  // moderation_cases has no version column in G2 (api-contract-g2.md), so a
  // repeat resolve (should the caller race itself) is naturally idempotent:
  // the second attempt's own entity-row CAS updateMany already fails first.
  private async resolveCaseAndRecordDecision(
    tx: Prisma.TransactionClient,
    entityType: string,
    entityId: string,
    outcome: string,
    reason: string | null,
    actorId: string,
  ): Promise<void> {
    const moderationCase = await tx.moderationCase.findFirst({
      where: { entityType, entityId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });
    if (moderationCase) {
      await tx.moderationCase.update({
        where: { id: moderationCase.id },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
    }
    await tx.moderationDecision.create({
      data: {
        entityType,
        entityId,
        moderationCaseId: moderationCase?.id ?? null,
        outcome,
        reason,
        decidedBy: actorId,
        decidedAt: new Date(),
      },
    });
  }

  private async decideProduct(
    id: string,
    version: number,
    target: ProductVariantOutcome,
    reason: string | null,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    const loaded = await this.prisma.product.findUnique({ where: { id } });
    if (!loaded) {
      throw new NotFoundException('Product not found.');
    }

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.product.updateMany({
        where: { id, version, status: 'PENDING_REVIEW' },
        data: { status: target, version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new InvalidStateTransitionError(
          'Product is not in PENDING_REVIEW, or was modified since it was read; reload and retry.',
        );
      }
      await this.resolveCaseAndRecordDecision(tx, 'product', id, target, reason, actor.id);
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product.moderation_decided',
      entityType: 'product',
      entityId: id,
      before: { status: loaded.status },
      after: { status: target, reason },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    // Not findOne(): the decided product may now be CHANGES_REQUESTED or
    // REJECTED (not PUBLISHED), and this is the admin's own response to
    // their own decision, not a public read — findOne()'s PUBLISHED-only
    // filter would otherwise 404 this response for both non-approval
    // outcomes.
    return this.productsService.findDetailForAdmin(id);
  }

  approveProduct(
    id: string,
    dto: ApproveDecisionDto,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decideProduct(id, dto.version, 'PUBLISHED', null, actor, requestContext);
  }

  needsChangesProduct(
    id: string,
    dto: DecisionReasonDto,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decideProduct(id, dto.version, 'CHANGES_REQUESTED', dto.reason, actor, requestContext);
  }

  rejectProduct(
    id: string,
    dto: DecisionReasonDto,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decideProduct(id, dto.version, 'REJECTED', dto.reason, actor, requestContext);
  }

  private async findVariantPayloadOrThrow(id: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      include: VARIANT_RELATIONS_INCLUDE,
    });
    if (!variant) {
      throw new NotFoundException('Variant not found.');
    }
    return toVariantPayload(variant as VariantWithRelations);
  }

  private async decideVariant(
    id: string,
    version: number,
    target: ProductVariantOutcome,
    reason: string | null,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    const loaded = await this.prisma.productVariant.findUnique({ where: { id } });
    if (!loaded) {
      throw new NotFoundException('Variant not found.');
    }

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.productVariant.updateMany({
        where: { id, version, status: 'PENDING_REVIEW' },
        data: { status: target, version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new InvalidStateTransitionError(
          'Variant is not in PENDING_REVIEW, or was modified since it was read; reload and retry.',
        );
      }
      await this.resolveCaseAndRecordDecision(tx, 'product_variant', id, target, reason, actor.id);
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product_variant.moderation_decided',
      entityType: 'product_variant',
      entityId: id,
      before: { status: loaded.status },
      after: { status: target, reason },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return this.findVariantPayloadOrThrow(id);
  }

  approveVariant(
    id: string,
    dto: ApproveDecisionDto,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decideVariant(id, dto.version, 'PUBLISHED', null, actor, requestContext);
  }

  needsChangesVariant(
    id: string,
    dto: DecisionReasonDto,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decideVariant(id, dto.version, 'CHANGES_REQUESTED', dto.reason, actor, requestContext);
  }

  rejectVariant(
    id: string,
    dto: DecisionReasonDto,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decideVariant(id, dto.version, 'REJECTED', dto.reason, actor, requestContext);
  }

  private async decideMedia(
    id: string,
    version: number,
    target: MediaOutcome,
    reason: string | null,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    const loaded = await this.prisma.productMedia.findUnique({ where: { id } });
    if (!loaded) {
      throw new NotFoundException('Media not found.');
    }

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.productMedia.updateMany({
        where: { id, version, moderationStatus: 'PENDING' },
        data: { moderationStatus: target, version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new InvalidStateTransitionError(
          'Media is not pending moderation, or was modified since it was read; reload and retry.',
        );
      }
      await this.resolveCaseAndRecordDecision(tx, 'product_media', id, target, reason, actor.id);
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product_media.moderation_decided',
      entityType: 'product_media',
      entityId: id,
      before: { moderation_status: loaded.moderationStatus },
      after: { moderation_status: target, reason },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    const updated = await this.prisma.productMedia.findUniqueOrThrow({ where: { id } });
    return toMediaPayload(updated);
  }

  approveMedia(
    id: string,
    dto: ApproveDecisionDto,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decideMedia(id, dto.version, 'APPROVED', null, actor, requestContext);
  }

  rejectMedia(
    id: string,
    dto: DecisionReasonDto,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decideMedia(id, dto.version, 'REJECTED', dto.reason, actor, requestContext);
  }
}
