import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import {
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '../../../common/http/api-error';
import { SellersService } from '../sellers.service';
import { normalizePhone } from '../../identity/lib/phone';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import type { SellerMemberWithSeller } from './member-access.guard';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { sellerRoleHasPermission } from './seller-permissions';
import { toMemberPayload } from './members.mapper';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
    private readonly auditService: AuditService,
  ) {}

  // Two distinct 403 reasons on purpose (TZ §34 names both as separate
  // threats to test): no membership at all = cross-seller/spoofing; a
  // membership that lacks seller:members:manage = privilege denial. Only the
  // second is audited as authz.permission_denied — the first is an identity
  // mismatch, not a permission a real member was ever close to having.
  private async requireMembersManagePermission(sellerId: string, actorId: string) {
    const membership = await this.sellersService.findMembership(sellerId, actorId);
    if (!membership) {
      throw new ForbiddenError('Caller is not a member of this seller.');
    }
    if (!sellerRoleHasPermission(membership.role, 'seller:members:manage')) {
      await this.auditService.record({
        actor: { id: actorId, type: 'USER' },
        action: 'authz.permission_denied',
        entityType: 'seller_permission',
        entityId: 'seller:members:manage',
        after: { seller_id: sellerId, caller_role: membership.role },
      });
      throw new ForbiddenError('Only a seller OWNER can manage members.');
    }
    return membership;
  }

  async list(actor: AuthenticatedUser, sellerId: string) {
    const membership = await this.sellersService.findMembership(sellerId, actor.id);
    if (!membership) {
      throw new ForbiddenError('Caller is not a member of this seller.');
    }

    const members = await this.prisma.sellerMember.findMany({
      where: { sellerId },
      orderBy: [{ createdAt: 'asc' }],
    });
    return members.map((member) => toMemberPayload(member));
  }

  async invite(actor: AuthenticatedUser, dto: InviteMemberDto) {
    await this.requireMembersManagePermission(dto.seller_id, actor.id);

    const phone = normalizePhone(dto.phone);
    if (!phone) {
      throw new ValidationError('phone must be a valid E.164 number.', {
        phone: ['must be a valid E.164 number (+ followed by 7-15 digits)'],
      });
    }

    const targetUser = await this.prisma.user.findUnique({ where: { phone } });
    if (!targetUser) {
      throw new ValidationError('No registered user found for this phone number.', {
        phone: ['no account exists for this phone number yet'],
      });
    }

    const existing = await this.sellersService.findMembership(dto.seller_id, targetUser.id);
    if (existing) {
      throw new ValidationError('This user is already a member of this seller.', {
        phone: ['already a member of this seller'],
      });
    }

    const member = await this.prisma.sellerMember.create({
      data: { sellerId: dto.seller_id, userId: targetUser.id, role: dto.role },
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_member.invited',
      entityType: 'seller_member',
      entityId: member.id,
      after: { seller_id: dto.seller_id, user_id: targetUser.id, role: member.role },
    });

    return toMemberPayload(member);
  }

  // Trusts MemberAccessGuard + OwnershipGuard + SellerPermissionGuard to
  // have already authorized this call (same trust boundary as
  // ApplicationsService.update/DocumentsService.confirm, which don't re-check
  // membership after their own access guards ran) — no duplicate permission
  // check here.
  async updateRole(
    actor: AuthenticatedUser,
    loaded: SellerMemberWithSeller,
    dto: UpdateMemberRoleDto,
  ) {
    // G1 QA review minor #1: a seller must always keep at least one OWNER —
    // demoting the last/only OWNER would leave the seller with no one able
    // to manage members, reinstate another OWNER, or recover. 409 (not 422):
    // the request body itself is well-formed, it only conflicts with the
    // current membership set, the same class of "valid request, invalid
    // given current state" conflict InvalidStateTransitionError already
    // covers elsewhere in this module tree.
    if (loaded.role === 'OWNER' && dto.role !== 'OWNER') {
      const ownerCount = await this.prisma.sellerMember.count({
        where: { sellerId: loaded.sellerId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new InvalidStateTransitionError(
          'Cannot change this role: the seller must always have at least one OWNER.',
        );
      }
    }

    // Compare-and-swap (G1 QA review major #2): guards against a concurrent
    // role change on the same seller_members row between our read above and
    // this write. Mirrors SessionService.rotateRefreshToken /
    // OtpService.rejectAttempt.
    const claim = await this.prisma.sellerMember.updateMany({
      where: { id: loaded.id, version: loaded.version },
      data: { role: dto.role, version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new InvalidStateTransitionError(
        'Seller member was modified by another request; reload and retry.',
      );
    }
    const updated = await this.prisma.sellerMember.findUniqueOrThrow({ where: { id: loaded.id } });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_member.role_changed',
      entityType: 'seller_member',
      entityId: updated.id,
      before: { role: loaded.role },
      after: { role: updated.role },
    });

    return toMemberPayload(updated);
  }
}
