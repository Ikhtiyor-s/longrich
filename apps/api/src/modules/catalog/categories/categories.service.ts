import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Category } from '@prisma/client';
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
import { toCategoryPayload } from './categories.mapper';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories.query.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

const DEFAULT_PAGE_LIMIT = 20;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ListCategoriesQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.prisma.category.findMany({
      where: {
        ...(query.parent_id ? { parentId: query.parent_id } : {}),
        ...(cursorKeysetWhere(cursor) ?? {}),
      },
      orderBy: CURSOR_KEYSET_ORDER_BY,
      take: limit + 1,
    });

    const { items, nextCursor } = paginate(rows, limit);
    return { items: items.map(toCategoryPayload), next_cursor: nextCursor };
  }

  async findByIdOrThrow(id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException('Category not found.');
    }
    return category;
  }

  async findOne(id: string) {
    const category = await this.findByIdOrThrow(id);
    return toCategoryPayload(category);
  }

  // No cycle check needed on create: a brand-new category id cannot already
  // be an ancestor of anything, so only "does the referenced parent exist"
  // is checked here. The cycle walk is PATCH-only (see update() below).
  async create(actor: AuthenticatedUser, dto: CreateCategoryDto, requestContext: RequestContext) {
    if (dto.parent_id) {
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parent_id } });
      if (!parent) {
        throw new ValidationError('parent_id does not reference an existing category.', {
          parent_id: ['unknown category id'],
        });
      }
    }

    let created: Category;
    try {
      created = await this.prisma.category.create({
        data: {
          parentId: dto.parent_id ?? null,
          slug: dto.slug,
          name: dto.name,
          requiresCertification: dto.requires_certification ?? false,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ValidationError('A category with this slug already exists.', {
          slug: ['already taken'],
        });
      }
      throw error;
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'category.created',
      entityType: 'category',
      entityId: created.id,
      after: { slug: created.slug, name: created.name, parent_id: created.parentId },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toCategoryPayload(created);
  }

  // Walks the candidate new parent's own ancestor chain looking for
  // `categoryId` — a hit means attaching categoryId under candidateParentId
  // would create a cycle. Self-parenting (candidateParentId === categoryId)
  // is caught as the trivial first step of the same walk.
  private async wouldCreateCycle(categoryId: string, candidateParentId: string): Promise<boolean> {
    let current: string | null = candidateParentId;
    const visited = new Set<string>();
    while (current) {
      if (current === categoryId) {
        return true;
      }
      if (visited.has(current)) {
        // Pre-existing cyclic data would otherwise spin forever; treat as a
        // cycle rather than loop indefinitely (should never happen given
        // this same check guards every write, but it's a cheap guard).
        return true;
      }
      visited.add(current);
      const node: { parentId: string | null } | null = await this.prisma.category.findUnique({
        where: { id: current },
        select: { parentId: true },
      });
      if (!node) {
        return false;
      }
      current = node.parentId;
    }
    return false;
  }

  async update(
    id: string,
    actor: AuthenticatedUser,
    dto: UpdateCategoryDto,
    requestContext: RequestContext,
  ) {
    const loaded = await this.findByIdOrThrow(id);

    // updateMany's mutation input only accepts scalar fields (no relation
    // connect/disconnect) — parentId is set directly as the FK scalar, not
    // via the `parent` relation.
    const data: Prisma.CategoryUncheckedUpdateManyInput = {};
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.requires_certification !== undefined) {
      data.requiresCertification = dto.requires_certification;
    }
    if (dto.status !== undefined) data.status = dto.status;

    if (dto.parent_id !== undefined) {
      if (dto.parent_id !== null) {
        if (dto.parent_id === id) {
          throw new ValidationError('parent_id cannot be the category itself.', {
            parent_id: ['would create a cycle'],
          });
        }
        const parent = await this.prisma.category.findUnique({ where: { id: dto.parent_id } });
        if (!parent) {
          throw new ValidationError('parent_id does not reference an existing category.', {
            parent_id: ['unknown category id'],
          });
        }
        if (await this.wouldCreateCycle(id, dto.parent_id)) {
          throw new ValidationError('parent_id would create a cycle in the category tree.', {
            parent_id: ['would create a cycle'],
          });
        }
      }
      data.parentId = dto.parent_id;
    }

    let claim: { count: number };
    try {
      claim = await this.prisma.category.updateMany({
        where: { id, version: dto.version },
        data: { ...data, version: { increment: 1 } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ValidationError('A category with this slug already exists.', {
          slug: ['already taken'],
        });
      }
      throw error;
    }

    if (claim.count === 0) {
      throw new InvalidStateTransitionError(
        'Category was modified by another request; reload and retry.',
      );
    }

    const updated = await this.prisma.category.findUniqueOrThrow({ where: { id } });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'category.updated',
      entityType: 'category',
      entityId: id,
      before: {
        slug: loaded.slug,
        name: loaded.name,
        parent_id: loaded.parentId,
        status: loaded.status,
        requires_certification: loaded.requiresCertification,
      },
      after: {
        slug: updated.slug,
        name: updated.name,
        parent_id: updated.parentId,
        status: updated.status,
        requires_certification: updated.requiresCertification,
      },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toCategoryPayload(updated);
  }
}
