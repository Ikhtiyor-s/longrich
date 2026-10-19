import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Seller, SellerApplication } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SellersService } from '../sellers.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';

export type SellerApplicationWithSeller = SellerApplication & { seller: Seller };

export interface LoadedApplicationResource {
  application: SellerApplicationWithSeller;
  isMember: boolean;
}

interface RequestWithLoadedApplication {
  params: { id: string };
  user?: AuthenticatedUser;
  loadedResource?: LoadedApplicationResource;
}

// Loads the :id seller_application (with its seller) and resolves whether
// the caller belongs to that seller via SellersService.findMembership,
// attaching both onto request.loadedResource for OwnershipGuard's
// synchronous resolver to consume (OwnershipGuard itself cannot do the async
// DB lookup — see docs/open-questions.md #30, left for T-G1-4 to decide the
// generic shape of; this guard is a module-local loader, not a change to the
// shared common/guards/ownership.guard.ts).
// Must run after JwtAuthGuard (needs request.user) and before OwnershipGuard:
// @UseGuards(JwtAuthGuard, ApplicationAccessGuard, OwnershipGuard).
@Injectable()
export class ApplicationAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithLoadedApplication>();
    const id = request.params.id;

    const application = await this.prisma.sellerApplication.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!application) {
      throw new NotFoundException('Seller application not found.');
    }

    const membership = request.user
      ? await this.sellersService.findMembership(application.sellerId, request.user.id)
      : null;

    request.loadedResource = { application, isMember: Boolean(membership) };
    return true;
  }
}
