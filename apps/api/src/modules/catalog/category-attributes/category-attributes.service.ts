import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CategoryAttribute } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { assertValidAttributeShape, type CategoryAttributeType } from './attribute-validation';
import { toCategoryAttributePayload } from './category-attributes.mapper';
import { CreateCategoryAttributeDto } from './dto/create-category-attribute.dto';
import { UpdateCategoryAttributeDto } from './dto/update-category-attribute.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

@Injectable()
export class CategoryAttributesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException('Category not found.');
    }
    return category;
  }

  async list(categoryId: string) {
    await this.requireCategory(categoryId);
    const rows = await this.prisma.categoryAttribute.findMany({
      where: { categoryId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toCategoryAttributePayload);
  }

  async findByIdOrThrow(categoryId: string, id: string): Promise<CategoryAttribute> {
    const attribute = await this.prisma.categoryAttribute.findUnique({ where: { id } });
    if (!attribute || attribute.categoryId !== categoryId) {
      throw new NotFoundException('Category attribute not found.');
    }
    return attribute;
  }

  async create(
    categoryId: string,
    actor: AuthenticatedUser,
    dto: CreateCategoryAttributeDto,
    requestContext: RequestContext,
  ) {
    await this.requireCategory(categoryId);
    assertValidAttributeShape(dto.type, dto.validation ?? null);

    let created: CategoryAttribute;
    try {
      created = await this.prisma.categoryAttribute.create({
        data: {
          categoryId,
          key: dto.key,
          label: dto.label,
          type: dto.type,
          required: dto.required ?? false,
          validation: (dto.validation ?? Prisma.DbNull) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ValidationError('A category attribute with this key already exists.', {
          key: ['already taken for this category'],
        });
      }
      throw error;
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'category_attribute.created',
      entityType: 'category_attribute',
      entityId: created.id,
      after: { category_id: categoryId, key: created.key, type: created.type },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toCategoryAttributePayload(created);
  }

  async update(
    categoryId: string,
    id: string,
    actor: AuthenticatedUser,
    dto: UpdateCategoryAttributeDto,
    requestContext: RequestContext,
  ) {
    const loaded = await this.findByIdOrThrow(categoryId, id);

    const effectiveType = (dto.type ?? loaded.type) as CategoryAttributeType;
    const effectiveValidation = dto.validation !== undefined ? dto.validation : loaded.validation;
    assertValidAttributeShape(effectiveType, effectiveValidation ?? null);

    const data: Prisma.CategoryAttributeUpdateManyMutationInput = {};
    if (dto.key !== undefined) data.key = dto.key;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.required !== undefined) data.required = dto.required;
    if (dto.validation !== undefined) {
      data.validation = (dto.validation ?? Prisma.DbNull) as Prisma.InputJsonValue;
    }

    let claim: { count: number };
    try {
      claim = await this.prisma.categoryAttribute.updateMany({
        where: { id, version: dto.version },
        data: { ...data, version: { increment: 1 } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ValidationError('A category attribute with this key already exists.', {
          key: ['already taken for this category'],
        });
      }
      throw error;
    }

    if (claim.count === 0) {
      throw new InvalidStateTransitionError(
        'Category attribute was modified by another request; reload and retry.',
      );
    }

    const updated = await this.prisma.categoryAttribute.findUniqueOrThrow({ where: { id } });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'category_attribute.updated',
      entityType: 'category_attribute',
      entityId: id,
      before: { key: loaded.key, type: loaded.type, required: loaded.required },
      after: { key: updated.key, type: updated.type, required: updated.required },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toCategoryAttributePayload(updated);
  }
}
