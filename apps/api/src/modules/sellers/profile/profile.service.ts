import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import {
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '../../../common/http/api-error';
import { SellersService } from '../sellers.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { sellerRoleHasPermission } from '../members/seller-permissions';
import { toSellerPayload } from '../seller.mapper';
import { UpdateProfileDto } from './dto/update-profile.dto';

// Customer-facing storefront content (TZ §06 SEL-004's "Profil, logotip,
// working hours, delivery terms" gloss) — TZ §29's "seller cannot publish
// while non-ACTIVE" rule is enforced on exactly these four keys. display_name
// is intentionally excluded: it already has cross-status editability via
// SEL-001's own write path (seller_applications PATCH, DRAFT-only), and
// gating it here too would make "PATCH succeeds regardless of status" (this
// ticket's own done-criteria wording) vacuously false for every field.
const PUBLISH_AFFECTING_FIELDS = [
  'description',
  'logo_object_key',
  'working_hours',
  'delivery_terms',
] as const;

type PublishAffectingField = (typeof PUBLISH_AFFECTING_FIELDS)[number];

const FIELD_TO_COLUMN: Record<
  PublishAffectingField,
  'description' | 'logoObjectKey' | 'workingHours' | 'deliveryTerms'
> = {
  description: 'description',
  logo_object_key: 'logoObjectKey',
  working_hours: 'workingHours',
  delivery_terms: 'deliveryTerms',
};

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
    private readonly auditService: AuditService,
  ) {}

  // Same two-reason 403 split MembersService/DocumentsService already use:
  // no membership at all is a plain cross-seller/spoofing denial (not
  // audited as a permission decision — the caller never had a role to
  // check); lacking seller:profile:manage is a real privilege denial and is
  // audited as authz.permission_denied.
  private async requireMembership(sellerId: string, userId: string) {
    const membership = await this.sellersService.findMembership(sellerId, userId);
    if (!membership) {
      throw new ForbiddenError('Caller is not a member of this seller.');
    }
    return membership;
  }

  // seller_members.seller_id is FK-restricted to an existing sellers row
  // (prisma/schema.prisma), so a resolved membership guarantees its seller
  // exists — the `!` below reflects that DB invariant, not an unchecked
  // assumption about caller input.
  async getProfile(actor: AuthenticatedUser, sellerId: string) {
    await this.requireMembership(sellerId, actor.id);

    const seller = (await this.sellersService.findById(sellerId))!;
    return toSellerPayload(seller);
  }

  async updateProfile(actor: AuthenticatedUser, dto: UpdateProfileDto) {
    const membership = await this.requireMembership(dto.seller_id, actor.id);
    if (!sellerRoleHasPermission(membership.role, 'seller:profile:manage')) {
      await this.auditService.record({
        actor: { id: actor.id, type: 'USER' },
        action: 'authz.permission_denied',
        entityType: 'seller_permission',
        entityId: 'seller:profile:manage',
        after: { seller_id: dto.seller_id, caller_role: membership.role },
      });
      throw new ForbiddenError('Only a seller OWNER or MANAGER can edit the shop profile.');
    }

    const seller = (await this.sellersService.findById(dto.seller_id))!;

    const blockedFields = PUBLISH_AFFECTING_FIELDS.filter(
      (field) => dto[field] !== undefined && seller.status !== 'ACTIVE',
    );
    if (blockedFields.length > 0) {
      throw new ValidationError(
        'Shop profile fields that affect the public storefront can only be changed while the seller is ACTIVE.',
        {
          status: [`seller.status is ${seller.status}, must be ACTIVE`],
          blocked_fields: blockedFields,
        },
      );
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const data: Record<string, unknown> = {};

    if (dto.display_name !== undefined) {
      before.display_name = seller.displayName;
      after.display_name = dto.display_name;
      data.displayName = dto.display_name;
    }
    for (const field of PUBLISH_AFFECTING_FIELDS) {
      if (dto[field] === undefined) continue;
      const column = FIELD_TO_COLUMN[field];
      before[field] = seller[column];
      after[field] = dto[field];
      data[column] = dto[field];
    }

    if (Object.keys(data).length === 0) {
      return toSellerPayload(seller);
    }

    // Compare-and-swap (G1 QA review major #2): guards against a concurrent
    // profile edit, or a concurrent status change (e.g. suspend) that would
    // invalidate the ACTIVE-only gate just checked above, between our read
    // and this write. Mirrors SessionService.rotateRefreshToken /
    // OtpService.rejectAttempt.
    const claim = await this.prisma.seller.updateMany({
      where: { id: seller.id, version: seller.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new InvalidStateTransitionError(
        'Seller was modified by another request; reload and retry.',
      );
    }
    const updated = await this.prisma.seller.findUniqueOrThrow({ where: { id: seller.id } });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_profile.updated',
      entityType: 'seller',
      entityId: seller.id,
      before,
      after,
    });

    return toSellerPayload(updated);
  }
}
