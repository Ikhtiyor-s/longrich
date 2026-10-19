import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  findCategoryById(id: string) {
    return this.prisma.category.findUnique({ where: { id } });
  }

  findVariantById(id: string) {
    return this.prisma.productVariant.findUnique({ where: { id } });
  }
}
