import { Injectable, NotFoundException } from '@nestjs/common';
import type { Seller, SellerApplication, SellerApplicationStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { toApplicationPayload } from '../applications/applications.mapper';
import { toSellerPayload } from '../seller.mapper';

export type SellerApplicationWithSeller = SellerApplication & { seller: Seller };

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

// SUBMITTED and UNDER_REVIEW are both accepted as the starting state for a
// decision: TZ §29 states the pipeline as a straight arrow
// (SUBMITTED->UNDER_REVIEW->APPROVED/NEEDS_CHANGES/REJECTED) without naming a
// distinct trigger that moves an application into UNDER_REVIEW on its own
// (unlike APPROVED->ACTIVE, which the ticket's own "Open design notes"
// explicitly calls out as needing its own step). Collapsing the SUBMITTED->
// UNDER_REVIEW hop into the same atomic decision action — rather than
// inventing an unscoped "claim"/"start review" endpoint the ticket never
// lists under "Files likely touched" or "How we'll know it's done" — is a
// judgment call flagged in this ticket's completion report, not a silent
// guess.
const REVIEWABLE_STATUSES: readonly SellerApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async loadApplicationOrThrow(id: string): Promise<SellerApplicationWithSeller> {
    const application = await this.prisma.sellerApplication.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!application) {
      throw new NotFoundException('Seller application not found.');
    }
    return application;
  }

  private async decide(
    loaded: SellerApplicationWithSeller,
    target: Extract<SellerApplicationStatus, 'APPROVED' | 'NEEDS_CHANGES' | 'REJECTED'>,
    actor: AuthenticatedUser,
    reason: string | null,
    requestContext: RequestContext,
  ) {
    if (!REVIEWABLE_STATUSES.includes(loaded.status)) {
      throw new InvalidStateTransitionError(
        `Seller application cannot be reviewed while in status ${loaded.status}.`,
      );
    }

    const eventType =
      target === 'APPROVED'
        ? 'seller_application.approved.v1'
        : target === 'REJECTED'
          ? 'seller_application.rejected.v1'
          : 'seller_application.needs_changes.v1';
    const auditAction =
      target === 'APPROVED'
        ? 'seller_application.approved'
        : target === 'REJECTED'
          ? 'seller_application.rejected'
          : 'seller_application.needs_changes';

    const result = await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap on the version+status read above (G1 QA review
      // major #2): two concurrent decisions on the same SUBMITTED/
      // UNDER_REVIEW application (e.g. one moderator approves while another
      // rejects) both pass the REVIEWABLE_STATUSES check above, but only the
      // first commit's updateMany actually matches this WHERE — Postgres's
      // row lock + WHERE re-check on UPDATE serializes the second request
      // against the first, so the loser's claim.count is 0 and it gets a
      // 409 here instead of silently overwriting the winner's decision.
      // Mirrors SessionService.rotateRefreshToken / OtpService.rejectAttempt.
      const applicationClaim = await tx.sellerApplication.updateMany({
        where: { id: loaded.id, version: loaded.version, status: loaded.status },
        data: {
          status: target,
          reviewerId: actor.id,
          reason,
          version: { increment: 1 },
        },
      });
      const sellerClaim = await tx.seller.updateMany({
        where: {
          id: loaded.sellerId,
          version: loaded.seller.version,
          status: loaded.seller.status,
        },
        data: { status: target, version: { increment: 1 } },
      });
      if (applicationClaim.count === 0 || sellerClaim.count === 0) {
        throw new InvalidStateTransitionError(
          'Seller application was modified by another request; reload and retry.',
        );
      }

      const application = await tx.sellerApplication.findUniqueOrThrow({
        where: { id: loaded.id },
      });
      const seller = await tx.seller.findUniqueOrThrow({ where: { id: loaded.sellerId } });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'seller_application',
          aggregateId: application.id,
          eventType,
          payload: {
            application_id: application.id,
            seller_id: seller.id,
            reviewer_id: actor.id,
            reason,
            decided_at: application.updatedAt.toISOString(),
          },
          occurredAt: new Date(),
        },
      });
      return { seller, application };
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: auditAction,
      entityType: 'seller_application',
      entityId: loaded.id,
      before: { status: loaded.status },
      after: { status: target, reason },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toApplicationPayload(result.seller, result.application);
  }

  approve(
    loaded: SellerApplicationWithSeller,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    return this.decide(loaded, 'APPROVED', actor, null, requestContext);
  }

  reject(
    loaded: SellerApplicationWithSeller,
    actor: AuthenticatedUser,
    reason: string,
    requestContext: RequestContext,
  ) {
    return this.decide(loaded, 'REJECTED', actor, reason, requestContext);
  }

  needsChanges(
    loaded: SellerApplicationWithSeller,
    actor: AuthenticatedUser,
    reason: string,
    requestContext: RequestContext,
  ) {
    return this.decide(loaded, 'NEEDS_CHANGES', actor, reason, requestContext);
  }

  // Separate, idempotent, independently-audited step from the approval
  // decision (docs/open-questions.md #29) — flips only sellers.status;
  // seller_applications has no ACTIVE value (schema comment: ACTIVE/
  // SUSPENDED live on Seller only), so the application row is left at its
  // terminal APPROVED status.
  async activate(
    loaded: SellerApplicationWithSeller,
    actor: AuthenticatedUser,
    requestContext: RequestContext,
  ) {
    if (loaded.status !== 'APPROVED') {
      throw new InvalidStateTransitionError(
        `Seller application must be APPROVED before activation (currently ${loaded.status}).`,
      );
    }
    if (loaded.seller.status !== 'APPROVED') {
      throw new InvalidStateTransitionError(
        `Seller cannot be activated while in status ${loaded.seller.status}.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap (G1 QA review major #2): guards against a
      // concurrent suspend/decision on the same seller row between our read
      // above and this write.
      const sellerClaim = await tx.seller.updateMany({
        where: { id: loaded.sellerId, version: loaded.seller.version, status: 'APPROVED' },
        data: { status: 'ACTIVE', version: { increment: 1 } },
      });
      if (sellerClaim.count === 0) {
        throw new InvalidStateTransitionError(
          'Seller was modified by another request; reload and retry.',
        );
      }
      const seller = await tx.seller.findUniqueOrThrow({ where: { id: loaded.sellerId } });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'seller',
          aggregateId: seller.id,
          eventType: 'seller.activated.v1',
          payload: {
            seller_id: seller.id,
            application_id: loaded.id,
            activated_by: actor.id,
            activated_at: seller.updatedAt.toISOString(),
          },
          occurredAt: new Date(),
        },
      });
      return { seller };
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller.activated',
      entityType: 'seller',
      entityId: loaded.sellerId,
      before: { status: 'APPROVED' },
      after: { status: 'ACTIVE' },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toSellerPayload(result.seller);
  }
}
