import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { CatalogImportJob, Seller, SellerMember } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SellersService } from '../../sellers/sellers.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';

export type CatalogImportJobWithSeller = CatalogImportJob & { seller: Seller };

export interface LoadedImportResource {
  job: CatalogImportJobWithSeller;
  callerMembership: SellerMember | null;
}

interface RequestWithLoadedImport {
  params: { id: string };
  user?: AuthenticatedUser;
  loadedResource?: LoadedImportResource;
}

// Same shape as offers/offer-access.guard.ts — loads the :id import job
// (with its seller) and resolves the caller's own membership row, attaching
// both onto request.loadedResource for OwnershipGuard + SellerPermissionGuard
// to consume. Must run before them:
// @UseGuards(ImportAccessGuard, OwnershipGuard, SellerPermissionGuard).
@Injectable()
export class ImportAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithLoadedImport>();
    const id = request.params.id;

    const job = await this.prisma.catalogImportJob.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!job) {
      throw new NotFoundException('Catalog import job not found.');
    }

    const callerMembership = request.user
      ? await this.sellersService.findMembership(job.sellerId, request.user.id)
      : null;

    request.loadedResource = { job, callerMembership };
    return true;
  }
}
