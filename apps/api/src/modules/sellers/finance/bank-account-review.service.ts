import { Injectable, NotFoundException } from '@nestjs/common';
import type { SellerBankAccount } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { toBankAccountPayload } from './bank-accounts.mapper';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

// Mirrors moderation.service.ts's (T-G1-5) loadOrThrow/decide shape, applied
// to seller_bank_accounts instead of seller_applications — per this ticket's
// own design note, reusing T-G1-5's reviewer/audit/outbox conventions, NOT
// seller_applications' own status enum (a bank account isn't an
// application). reviewedAt IS NULL is the "still reviewable" gate, in place
// of REVIEWABLE_STATUSES there: once reviewed (approved or rejected), a
// repeat decision is a 409, never a silent overwrite — same bar T-G1-5's
// own "re-approving an already-APPROVED application" test proves.
@Injectable()
export class BankAccountReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async loadOrThrow(id: string): Promise<SellerBankAccount> {
    const bankAccount = await this.prisma.sellerBankAccount.findUnique({ where: { id } });
    if (!bankAccount) {
      throw new NotFoundException('Seller bank account not found.');
    }
    return bankAccount;
  }

  private async decide(
    loaded: SellerBankAccount,
    verified: boolean,
    actor: AuthenticatedUser,
    reason: string | null,
    requestContext: RequestContext,
  ) {
    if (loaded.reviewedAt !== null) {
      throw new InvalidStateTransitionError(
        'This bank account reference has already been reviewed.',
      );
    }

    const eventType = verified
      ? 'seller_bank_account.approved.v1'
      : 'seller_bank_account.rejected.v1';
    const auditAction = verified ? 'seller_bank_account.approved' : 'seller_bank_account.rejected';

    const bankAccount = await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap (G1 QA review major #2): two concurrent decisions
      // on the same not-yet-reviewed row (e.g. one moderator approves while
      // another rejects) both pass the reviewedAt-IS-NULL check above, but
      // only the first commit's updateMany still matches reviewedAt: null —
      // the second loses the race (count 0) and gets a 409 instead of
      // silently overwriting the first decision. Mirrors
      // SessionService.rotateRefreshToken / OtpService.rejectAttempt.
      const claim = await tx.sellerBankAccount.updateMany({
        where: { id: loaded.id, version: loaded.version, reviewedAt: null },
        data: {
          verified,
          reviewerId: actor.id,
          reviewedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw new InvalidStateTransitionError(
          'This bank account reference was already reviewed by another request.',
        );
      }
      const updated = await tx.sellerBankAccount.findUniqueOrThrow({ where: { id: loaded.id } });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'seller_bank_account',
          aggregateId: updated.id,
          eventType,
          payload: {
            bank_account_id: updated.id,
            seller_id: updated.sellerId,
            reviewer_id: actor.id,
            reason,
            decided_at: updated.updatedAt.toISOString(),
          },
          occurredAt: new Date(),
        },
      });
      return updated;
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: auditAction,
      entityType: 'seller_bank_account',
      entityId: loaded.id,
      before: { verified: loaded.verified },
      after: { verified, reason },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toBankAccountPayload(bankAccount);
  }

  approve(loaded: SellerBankAccount, actor: AuthenticatedUser, requestContext: RequestContext) {
    return this.decide(loaded, true, actor, null, requestContext);
  }

  reject(
    loaded: SellerBankAccount,
    actor: AuthenticatedUser,
    reason: string,
    requestContext: RequestContext,
  ) {
    return this.decide(loaded, false, actor, reason, requestContext);
  }
}
