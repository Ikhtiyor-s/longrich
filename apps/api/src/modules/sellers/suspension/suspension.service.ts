import { Injectable, NotFoundException } from '@nestjs/common';
import type { Seller } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError } from '../../../common/http/api-error';
import { SellersService } from '../sellers.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { toSellerPayload } from '../seller.mapper';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

@Injectable()
export class SuspensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
    private readonly auditService: AuditService,
  ) {}

  async loadSellerOrThrow(id: string): Promise<Seller> {
    const seller = await this.sellersService.findById(id);
    if (!seller) {
      throw new NotFoundException('Seller not found.');
    }
    return seller;
  }

  // Enforcement against real offers/orders ("suspended seller cannot
  // publish/transact") is deferred to G2/G4 (those tables don't exist yet);
  // "existing orders handled by cancellation/fulfillment policy" on
  // suspension is deferred to G4's order-cancellation design. This only
  // flips the seller entity's own status and emits the event other modules
  // will eventually react to.
  async suspend(
    loaded: Seller,
    actor: AuthenticatedUser,
    reason: string,
    requestContext: RequestContext,
  ) {
    if (loaded.status !== 'ACTIVE') {
      throw new InvalidStateTransitionError(
        `Seller cannot be suspended while in status ${loaded.status}.`,
      );
    }

    const seller = await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap (G1 QA review major #2): a concurrent
      // activate/suspend/reinstate on the same seller row between our read
      // above and this write loses the race here (count 0) instead of
      // silently overwriting whichever request committed first. Mirrors
      // SessionService.rotateRefreshToken / OtpService.rejectAttempt.
      const claim = await tx.seller.updateMany({
        where: { id: loaded.id, version: loaded.version, status: 'ACTIVE' },
        data: { status: 'SUSPENDED', version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new InvalidStateTransitionError(
          'Seller was modified by another request; reload and retry.',
        );
      }
      const updated = await tx.seller.findUniqueOrThrow({ where: { id: loaded.id } });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'seller',
          aggregateId: updated.id,
          eventType: 'seller.suspended.v1',
          payload: {
            seller_id: updated.id,
            suspended_by: actor.id,
            reason,
            suspended_at: updated.updatedAt.toISOString(),
          },
          occurredAt: new Date(),
        },
      });
      return updated;
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller.suspended',
      entityType: 'seller',
      entityId: loaded.id,
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED', reason },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toSellerPayload(seller);
  }

  async reinstate(
    loaded: Seller,
    actor: AuthenticatedUser,
    reason: string | null,
    requestContext: RequestContext,
  ) {
    if (loaded.status !== 'SUSPENDED') {
      throw new InvalidStateTransitionError(
        `Seller cannot be reinstated while in status ${loaded.status}.`,
      );
    }

    const seller = await this.prisma.$transaction(async (tx) => {
      // Same compare-and-swap guard as suspend() above.
      const claim = await tx.seller.updateMany({
        where: { id: loaded.id, version: loaded.version, status: 'SUSPENDED' },
        data: { status: 'ACTIVE', version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new InvalidStateTransitionError(
          'Seller was modified by another request; reload and retry.',
        );
      }
      const updated = await tx.seller.findUniqueOrThrow({ where: { id: loaded.id } });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'seller',
          aggregateId: updated.id,
          eventType: 'seller.reinstated.v1',
          payload: {
            seller_id: updated.id,
            reinstated_by: actor.id,
            reason,
            reinstated_at: updated.updatedAt.toISOString(),
          },
          occurredAt: new Date(),
        },
      });
      return updated;
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller.reinstated',
      entityType: 'seller',
      entityId: loaded.id,
      before: { status: 'SUSPENDED' },
      after: { status: 'ACTIVE', reason },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toSellerPayload(seller);
  }
}
