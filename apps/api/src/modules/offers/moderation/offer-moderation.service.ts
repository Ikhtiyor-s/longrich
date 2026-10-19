import { Injectable, NotFoundException } from '@nestjs/common';
import type { OfferStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { toOfferPayload } from '../offers.mapper';
import { ApproveDecisionDto } from './dto/approve-decision.dto';
import { DecisionReasonDto } from './dto/decision-reason.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

type OfferDecisionOutcome = Extract<OfferStatus, 'ACTIVE' | 'INACTIVE' | 'REJECTED'>;

// Offer-side of T-G2-7's module split (product/variant/media decisions live
// in catalog/moderation/, per api-contract-g2.md's resolved "exact module
// home" note). Reads/writes SellerOffer directly — offers-owned data, no
// cross-module DI needed — and ModerationCase/ModerationDecision directly,
// which the contract explicitly allows both modules to write (shared
// admin-audit/platform tables, same as AuditLog/OutboxEvent).
@Injectable()
export class OfferModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async decide(
    id: string,
    version: number,
    target: OfferDecisionOutcome,
    reason: string | null,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    const loaded = await this.prisma.sellerOffer.findUnique({ where: { id } });
    if (!loaded) {
      throw new NotFoundException('Offer not found.');
    }

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.sellerOffer.updateMany({
        where: { id, version, status: 'PENDING_REVIEW' },
        data: { status: target, version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new InvalidStateTransitionError(
          'Offer is not in PENDING_REVIEW, or was modified since it was read; reload and retry.',
        );
      }

      const moderationCase = await tx.moderationCase.findFirst({
        where: { entityType: 'offer', entityId: id, status: 'OPEN' },
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
          entityType: 'offer',
          entityId: id,
          moderationCaseId: moderationCase?.id ?? null,
          outcome: target,
          reason,
          decidedBy: actor.id,
          decidedAt: new Date(),
        },
      });
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_offer.moderation_decided',
      entityType: 'seller_offer',
      entityId: id,
      before: { status: loaded.status },
      after: { status: target, reason },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    const updated = await this.prisma.sellerOffer.findUniqueOrThrow({ where: { id } });
    return toOfferPayload(updated);
  }

  approve(id: string, dto: ApproveDecisionDto, actor: AuthenticatedUser, requestContext: RequestContext) {
    return this.decide(id, dto.version, 'ACTIVE', null, actor, requestContext);
  }

  deactivate(
    id: string,
    dto: DecisionReasonDto,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decide(id, dto.version, 'INACTIVE', dto.reason, actor, requestContext);
  }

  reject(id: string, dto: DecisionReasonDto, actor: AuthenticatedUser, requestContext: RequestContext) {
    return this.decide(id, dto.version, 'REJECTED', dto.reason, actor, requestContext);
  }
}
