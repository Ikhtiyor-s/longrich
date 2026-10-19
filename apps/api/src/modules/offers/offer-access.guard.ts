import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Seller, SellerMember, SellerOffer } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SellersService } from '../sellers/sellers.service';
import type { AuthenticatedUser } from '../identity/auth/current-user.decorator';

export type SellerOfferWithSeller = SellerOffer & { seller: Seller };

export interface LoadedOfferResource {
  offer: SellerOfferWithSeller;
  // Caller's own full seller_members row (not just a boolean) — same shape
  // as sellers/members/member-access.guard.ts's LoadedMemberResource:
  // SellerPermissionGuard (reused as-is on the PATCH/submit routes) needs
  // the caller's own role, OwnershipGuard's resolver only needs
  // presence/absence.
  callerMembership: SellerMember | null;
}

interface RequestWithLoadedOffer {
  params: { id: string };
  user?: AuthenticatedUser;
  loadedResource?: LoadedOfferResource;
}

// Same shape as MemberAccessGuard/DocumentAccessGuard (T-G1-4's resolution
// of docs/open-questions.md #30), applied to the seller_offers resource for
// the first time: loads the :id offer (with its seller) and resolves the
// caller's own membership row for that seller, attaching both onto
// request.loadedResource for OwnershipGuard's resolver (and
// SellerPermissionGuard, on routes that also require it) to consume. Must
// run before OwnershipGuard/SellerPermissionGuard:
// @UseGuards(OfferAccessGuard, OwnershipGuard, SellerPermissionGuard).
@Injectable()
export class OfferAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithLoadedOffer>();
    const id = request.params.id;

    const offer = await this.prisma.sellerOffer.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found.');
    }

    const callerMembership = request.user
      ? await this.sellersService.findMembership(offer.sellerId, request.user.id)
      : null;

    request.loadedResource = { offer, callerMembership };
    return true;
  }
}
