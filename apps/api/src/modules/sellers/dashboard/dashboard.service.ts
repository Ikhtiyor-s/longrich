import { Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../../common/http/api-error';
import { SellersService } from '../sellers.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';

// Each section names the real milestone that attaches a live query behind
// the seller:offers:manage/seller:inventory:view/seller:orders:view codes
// already registered in members/seller-permissions.ts — never a bare empty
// array/zero, which would be indistinguishable from "this seller genuinely
// has none." SEL-007's own traceability entry (docs/traceability.md) pins
// the real order queue to G6, which itself needs G4 (orders) first, hence
// "G4/G6" rather than a single milestone for that section only.
const DASHBOARD_SECTIONS = {
  offers: { status: 'NOT_AVAILABLE' as const, available_from: 'G2' },
  inventory: { status: 'NOT_AVAILABLE' as const, available_from: 'G3' },
  orders: { status: 'NOT_AVAILABLE' as const, available_from: 'G4/G6' },
};

@Injectable()
export class DashboardService {
  constructor(private readonly sellersService: SellersService) {}

  // Same membership-only gate as ProfileService.getProfile (any role,
  // OPERATOR included, can view) — the three new permission codes exist for
  // G2/G3/G4/G6's future real endpoints to gate, not for this shell to gate,
  // since every member is equally entitled to see "not available yet."
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
  async getDashboard(actor: AuthenticatedUser, sellerId: string) {
    await this.requireMembership(sellerId, actor.id);

    const seller = (await this.sellersService.findById(sellerId))!;
    return {
      seller_id: seller.id,
      seller_status: seller.status,
      sections: DASHBOARD_SECTIONS,
    };
  }
}
