import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Seller, SellerDocument } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SellersService } from '../sellers.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';

export type SellerDocumentWithSeller = SellerDocument & { seller: Seller };

export interface LoadedDocumentResource {
  document: SellerDocumentWithSeller;
  isMember: boolean;
}

interface RequestWithLoadedDocument {
  params: { id: string };
  user?: AuthenticatedUser;
  loadedResource?: LoadedDocumentResource;
}

// Same shape as ApplicationAccessGuard, different entity: loads the :id
// seller_document (with its seller) and resolves whether the caller belongs
// to that seller via SellersService.findMembership, attaching both onto
// request.loadedResource for OwnershipGuard's resolver to consume. Must run
// after JwtAuthGuard and before OwnershipGuard:
// @UseGuards(JwtAuthGuard, DocumentAccessGuard, OwnershipGuard).
@Injectable()
export class DocumentAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithLoadedDocument>();
    const id = request.params.id;

    const document = await this.prisma.sellerDocument.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!document) {
      throw new NotFoundException('Seller document not found.');
    }

    const membership = request.user
      ? await this.sellersService.findMembership(document.sellerId, request.user.id)
      : null;

    request.loadedResource = { document, isMember: Boolean(membership) };
    return true;
  }
}
