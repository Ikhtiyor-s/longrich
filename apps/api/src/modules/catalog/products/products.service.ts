import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Product } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import {
  CURSOR_KEYSET_ORDER_BY,
  cursorKeysetWhere,
  decodeCursor,
  paginate,
} from '../../../common/pagination/cursor';
import { sanitizeDescription } from './sanitize-description';
import {
  toProductDetailPayload,
  toProductListItemPayload,
  type ProductDetailRow,
  type ProductListRow,
} from './products.mapper';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

const DEFAULT_PAGE_LIMIT = 20;
const NON_TERMINAL_STATUSES: Array<'DRAFT' | 'CHANGES_REQUESTED'> = ['DRAFT', 'CHANGES_REQUESTED'];
const TERMINAL_STATUSES: Array<'REJECTED' | 'ARCHIVED'> = ['REJECTED', 'ARCHIVED'];

const DETAIL_INCLUDE = {
  brand: true,
  variants: {
    include: {
      attributeValues: { include: { categoryAttribute: true } },
      media: { orderBy: { position: 'asc' as const } },
    },
  },
  media: { orderBy: { position: 'asc' as const } },
};

// Public detail view: callers never see an unpublished product at all
// (404), and even on a PUBLISHED product only APPROVED media is shown —
// mirrors the list endpoint's cover_media precedent (media: { where:
// { moderationStatus: 'APPROVED' } }), applied at both the product level
// and each variant's own media[] (both leak PENDING/REJECTED object_key +
// status otherwise, independent of the product's own status).
const PUBLIC_MEDIA_FILTER = {
  where: { moderationStatus: 'APPROVED' as const },
  orderBy: { position: 'asc' as const },
};
const PUBLIC_DETAIL_INCLUDE = {
  brand: true,
  variants: {
    include: {
      attributeValues: { include: { categoryAttribute: true } },
      media: PUBLIC_MEDIA_FILTER,
    },
  },
  media: PUBLIC_MEDIA_FILTER,
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ListProductsQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = (await this.prisma.product.findMany({
      where: {
        status: 'PUBLISHED',
        ...(query.category_id ? { categoryId: query.category_id } : {}),
        ...(cursorKeysetWhere(cursor) ?? {}),
      },
      orderBy: CURSOR_KEYSET_ORDER_BY,
      take: limit + 1,
      include: {
        brand: true,
        media: { where: { moderationStatus: 'APPROVED' }, orderBy: { position: 'asc' }, take: 1 },
      },
    })) as ProductListRow[];

    const { items, nextCursor } = paginate(rows, limit);
    return { items: items.map(toProductListItemPayload), next_cursor: nextCursor };
  }

  async findByIdOrThrow(id: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    return product;
  }

  private async findDetailOrThrow(id: string): Promise<ProductDetailRow> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    return product as ProductDetailRow;
  }

  // Public detail fetch: unknown id AND a non-PUBLISHED id both 404 — this
  // is the only by-id GET route in G2 with no caller-identity distinction
  // (no guard at all on this controller method), so "safe default is 404
  // for everyone" per the info-disclosure fix is the only correct reading;
  // an admin-only non-published detail view was never specified as a
  // separate route anywhere in api-contract-g2.md and is not invented here.
  private async findPublicDetailOrThrow(id: string): Promise<ProductDetailRow> {
    const product = await this.prisma.product.findFirst({
      where: { id, status: 'PUBLISHED' },
      include: PUBLIC_DETAIL_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    return product as ProductDetailRow;
  }

  private async toDetailPayload(product: ProductDetailRow) {
    const latestModerationDecision = await this.prisma.moderationDecision.findFirst({
      where: { entityType: 'product', entityId: product.id },
      orderBy: { decidedAt: 'desc' },
    });
    return toProductDetailPayload(product, latestModerationDecision);
  }

  async findOne(id: string) {
    return this.toDetailPayload(await this.findPublicDetailOrThrow(id));
  }

  // Unfiltered detail fetch for trusted, already-authenticated/authorized
  // in-module callers (this service's own create/update/submit below, and
  // CatalogModerationService's post-decision response) that must see their
  // own just-created/just-decided product regardless of its current
  // status — never exposed through a public route. Distinct from the
  // public findOne() above, which is the one the info-disclosure fix
  // targets.
  async findDetailForAdmin(id: string) {
    return this.toDetailPayload(await this.findDetailOrThrow(id));
  }

  private async requireCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new ValidationError('category_id does not reference an existing category.', {
        category_id: ['unknown category id'],
      });
    }
  }

  private async requireBrand(brandId: string): Promise<void> {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) {
      throw new ValidationError('brand_id does not reference an existing brand.', {
        brand_id: ['unknown brand id'],
      });
    }
  }

  async create(actor: AuthenticatedUser, dto: CreateProductDto, requestContext: RequestContext) {
    await this.requireCategory(dto.category_id);
    if (dto.brand_id) {
      await this.requireBrand(dto.brand_id);
    }

    const created = await this.prisma.product.create({
      data: {
        categoryId: dto.category_id,
        brandId: dto.brand_id ?? null,
        title: dto.title,
        description: dto.description !== undefined ? sanitizeDescription(dto.description) : null,
      },
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product.created',
      entityType: 'product',
      entityId: created.id,
      after: { category_id: created.categoryId, title: created.title },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return this.findDetailForAdmin(created.id);
  }

  async update(id: string, actor: AuthenticatedUser, dto: UpdateProductDto, requestContext: RequestContext) {
    const loaded = await this.findByIdOrThrow(id);

    if (dto.category_id !== undefined) {
      await this.requireCategory(dto.category_id);
    }
    if (dto.brand_id) {
      await this.requireBrand(dto.brand_id);
    }

    const data: Prisma.ProductUncheckedUpdateManyInput = {};
    if (dto.category_id !== undefined) data.categoryId = dto.category_id;
    if (dto.brand_id !== undefined) data.brandId = dto.brand_id;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = sanitizeDescription(dto.description);

    // Single CAS updateMany folding both checks into one atomic guard, per
    // api-contract-g2.md's inherited convention
    // (updateMany({where:{id,version,...stateGuard}})) — a lost race (stale
    // version) and an attempted edit of a terminal (REJECTED/ARCHIVED)
    // product both resolve to the same 409 INVALID_STATE_TRANSITION, exactly
    // as the frozen contract states for this endpoint.
    const claim = await this.prisma.product.updateMany({
      where: { id, version: dto.version, status: { notIn: TERMINAL_STATUSES } },
      data: { ...data, version: { increment: 1 } },
    });

    if (claim.count === 0) {
      throw new InvalidStateTransitionError(
        'Product was modified by another request, or is in a terminal state that cannot be edited.',
      );
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product.updated',
      entityType: 'product',
      entityId: id,
      before: { title: loaded.title, category_id: loaded.categoryId, brand_id: loaded.brandId },
      after: { title: dto.title ?? loaded.title },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return this.findDetailForAdmin(id);
  }

  async submit(id: string, actor: AuthenticatedUser, requestContext: RequestContext) {
    // Loaded first so an unknown id surfaces as 404, not 409 — same ordering
    // VariantsService.submit uses.
    await this.findByIdOrThrow(id);

    const claim = await this.prisma.product.updateMany({
      where: { id, status: { in: NON_TERMINAL_STATUSES } },
      data: { status: 'PENDING_REVIEW', version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new InvalidStateTransitionError('Product is not in a submittable state.');
    }

    await this.prisma.moderationCase.create({
      data: { entityType: 'product', entityId: id },
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product.submitted',
      entityType: 'product',
      entityId: id,
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return this.findDetailForAdmin(id);
  }
}
