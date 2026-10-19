import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

// T-G1-1: bare Prisma-backed provider. No controller, no business rules
// (submit gating, moderation decisions, bank masking, etc.) — those land in
// their own G1 tickets per docs/adr/ADR-001-architecture.md's module list.
// findMembership exists now because T-G1-4's ownership-resolver design note
// (docs/open-questions.md #30) needs exactly this seller_id+user_id lookup;
// it is intentionally a plain data lookup, not an authorization decision —
// callers decide what "authorized" means for their own endpoint.
@Injectable()
export class SellersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.seller.findUnique({ where: { id } });
  }

  findMembership(sellerId: string, userId: string) {
    return this.prisma.sellerMember.findUnique({
      where: { sellerId_userId: { sellerId, userId } },
    });
  }
}
