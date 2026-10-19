import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ForbiddenError } from '../../../common/http/api-error';
import { SellersService } from '../sellers.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { sellerRoleHasPermission, type SellerPermissionCode } from '../members/seller-permissions';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { maskBankReference, toBankAccountPayload } from './bank-accounts.mapper';

// Real commission/ledger data is G5 scope (this ticket's own "Why this
// ticket exists" note) — same NOT_AVAILABLE placeholder convention
// DASHBOARD_SECTIONS (dashboard.service.ts, T-G1-7) already established, so
// the response shape is reserved now and G5 can fill it in later without a
// breaking API change.
const FINANCE_SUMMARY_PLACEHOLDER = {
  status: 'NOT_AVAILABLE' as const,
  available_from: 'G5',
};

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
    private readonly auditService: AuditService,
  ) {}

  // Same two-reason 403 split every other service-level seller-permission
  // check in this module uses (MembersService.invite/ProfileService.update):
  // no membership at all is cross-seller/spoofing (not audited as a
  // permission decision — the caller never had a role to check); a
  // membership lacking the required code is a real privilege denial and is
  // audited as authz.permission_denied.
  private async requirePermission(
    sellerId: string,
    actor: AuthenticatedUser,
    code: SellerPermissionCode,
    deniedMessage: string,
  ) {
    const membership = await this.sellersService.findMembership(sellerId, actor.id);
    if (!membership) {
      throw new ForbiddenError('Caller is not a member of this seller.');
    }
    if (!sellerRoleHasPermission(membership.role, code)) {
      await this.auditService.record({
        actor: { id: actor.id, type: 'USER' },
        action: 'authz.permission_denied',
        entityType: 'seller_permission',
        entityId: code,
        after: { seller_id: sellerId, caller_role: membership.role },
      });
      throw new ForbiddenError(deniedMessage);
    }
    return membership;
  }

  async getSummary(actor: AuthenticatedUser, sellerId: string) {
    await this.requirePermission(
      sellerId,
      actor,
      'seller:finance:view',
      'Only a seller OWNER or MANAGER can view finance data.',
    );
    return {
      seller_id: sellerId,
      summary: FINANCE_SUMMARY_PLACEHOLDER,
    };
  }

  async listBankAccounts(actor: AuthenticatedUser, sellerId: string) {
    await this.requirePermission(
      sellerId,
      actor,
      'seller:finance:view',
      'Only a seller OWNER or MANAGER can view bank data.',
    );

    const bankAccounts = await this.prisma.sellerBankAccount.findMany({
      where: { sellerId },
      orderBy: [{ createdAt: 'desc' }],
    });
    return bankAccounts.map((bankAccount) => toBankAccountPayload(bankAccount));
  }

  async createBankAccount(actor: AuthenticatedUser, dto: CreateBankAccountDto) {
    await this.requirePermission(
      dto.seller_id,
      actor,
      'seller:bank:manage',
      'Only a seller OWNER can propose a bank detail change.',
    );

    const bankAccount = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sellerBankAccount.create({
        data: { sellerId: dto.seller_id, rawReference: dto.reference },
      });
      // "Sensitive bank changes trigger review" (TZ §06 SEL-008 acceptance
      // criterion): the unverified row itself plus this outbox event IS the
      // review trigger — per this ticket's own design note, there is no
      // separate review-case table to insert into.
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'seller_bank_account',
          aggregateId: created.id,
          eventType: 'seller_bank_account.proposed.v1',
          payload: {
            bank_account_id: created.id,
            seller_id: created.sellerId,
            proposed_by: actor.id,
            proposed_at: created.createdAt.toISOString(),
          },
          occurredAt: new Date(),
        },
      });
      return created;
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_bank_account.proposed',
      entityType: 'seller_bank_account',
      entityId: bankAccount.id,
      after: {
        seller_id: dto.seller_id,
        masked_reference: maskBankReference(dto.reference),
      },
    });

    return toBankAccountPayload(bankAccount);
  }
}
