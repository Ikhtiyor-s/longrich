import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Seller, SellerMember } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SellersService } from '../sellers.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';

export type SellerMemberWithSeller = SellerMember & { seller: Seller };

export interface LoadedMemberResource {
  targetMember: SellerMemberWithSeller;
  // Unlike ApplicationAccessGuard/DocumentAccessGuard's boolean isMember,
  // this keeps the caller's own full seller_members row (not just a bool) —
  // SellerPermissionGuard needs the caller's own role to decide OWNER-only
  // actions, OwnershipGuard's resolver only needs its presence/absence.
  callerMembership: SellerMember | null;
}

interface RequestWithLoadedMember {
  params: { id: string };
  user?: AuthenticatedUser;
  loadedResource?: LoadedMemberResource;
}

// Same shape as ApplicationAccessGuard/DocumentAccessGuard: loads the :id
// seller_member (with its seller) and resolves the caller's own membership
// row for that seller via SellersService.findMembership, attaching both onto
// request.loadedResource. Must run before OwnershipGuard and
// SellerPermissionGuard:
// @UseGuards(MemberAccessGuard, OwnershipGuard, SellerPermissionGuard).
@Injectable()
export class MemberAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithLoadedMember>();
    const id = request.params.id;

    const targetMember = await this.prisma.sellerMember.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!targetMember) {
      throw new NotFoundException('Seller member not found.');
    }

    const callerMembership = request.user
      ? await this.sellersService.findMembership(targetMember.sellerId, request.user.id)
      : null;

    request.loadedResource = { targetMember, callerMembership };
    return true;
  }
}
