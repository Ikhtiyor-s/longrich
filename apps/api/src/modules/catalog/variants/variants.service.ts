import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CategoryAttribute, type Product, type ProductVariant } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import {
  assertAttributeValueMatchesRule,
  type CategoryAttributeType,
} from '../category-attributes/attribute-validation';
import { computeOptionsHash } from './options-hash';
import { toVariantPayload, type VariantWithRelations } from './variants.mapper';
import { AttributeValueInputDto, CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

const NON_TERMINAL_STATUSES: Array<'DRAFT' | 'CHANGES_REQUESTED'> = ['DRAFT', 'CHANGES_REQUESTED'];

function isScalar(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function assertWellFormedOptions(options: Record<string, unknown>): void {
  const keys = Object.keys(options);
  if (keys.length === 0 || !keys.every((key) => isScalar(options[key]))) {
    throw new ValidationError('options must be a flat object of scalar values.', {
      options: ['options must be a non-empty object of string/number/boolean values'],
    });
  }
}

const VARIANT_RELATIONS_INCLUDE = {
  attributeValues: { include: { categoryAttribute: true } },
  media: { orderBy: { position: 'asc' as const } },
};

function duplicateOptionsError(): ValidationError {
  return new ValidationError('A variant with this options combination already exists.', {
    options: ['duplicate options combination for this product'],
  });
}

@Injectable()
export class VariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async requireProduct(productId: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    return product;
  }

  async findByIdOrThrow(id: string): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id } });
    if (!variant) {
      throw new NotFoundException('Variant not found.');
    }
    return variant;
  }

  // The method offers/imports call via DI once T-G2-5/T-G2-8 land
  // (api-contract-g2.md's file structure names this signature explicitly) —
  // implemented now even though nothing in this ticket's own scope calls it
  // yet, since the cross-module contract already pins the exact method name.
  async findPublishedOrThrow(variantId: string): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant || variant.status !== 'PUBLISHED') {
      throw new NotFoundException('Variant not found.');
    }
    return variant;
  }

  private async findWithRelationsOrThrow(id: string): Promise<VariantWithRelations> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      include: VARIANT_RELATIONS_INCLUDE,
    });
    if (!variant) {
      throw new NotFoundException('Variant not found.');
    }
    return variant as VariantWithRelations;
  }

  private async assertAttributeValuesValid(
    categoryId: string,
    attributeValues: AttributeValueInputDto[],
  ): Promise<void> {
    if (attributeValues.length === 0) {
      return;
    }
    const categoryAttributes = await this.prisma.categoryAttribute.findMany({
      where: { categoryId },
    });
    const byId = new Map<string, CategoryAttribute>(categoryAttributes.map((attr) => [attr.id, attr]));

    for (const entry of attributeValues) {
      const attribute = byId.get(entry.category_attribute_id);
      if (!attribute) {
        throw new ValidationError(
          'attribute_values references a category_attribute_id that does not belong to this product\'s category.',
          { attribute_values: [`unknown category_attribute_id: ${entry.category_attribute_id}`] },
        );
      }
      assertAttributeValueMatchesRule(
        attribute.type as CategoryAttributeType,
        attribute.validation,
        attribute.key,
        entry.value,
      );
    }
  }

  async create(productId: string, actor: AuthenticatedUser, dto: CreateVariantDto, requestContext: RequestContext) {
    const product = await this.requireProduct(productId);
    assertWellFormedOptions(dto.options);
    const attributeValues = dto.attribute_values ?? [];
    await this.assertAttributeValuesValid(product.categoryId, attributeValues);

    const optionsHash = computeOptionsHash(dto.options);

    let created: ProductVariant;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.create({
          data: {
            productId,
            options: dto.options as Prisma.InputJsonValue,
            optionsHash,
          },
        });
        for (const entry of attributeValues) {
          await tx.productAttributeValue.create({
            data: {
              variantId: variant.id,
              categoryAttributeId: entry.category_attribute_id,
              value: entry.value as Prisma.InputJsonValue,
            },
          });
        }
        return variant;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw duplicateOptionsError();
      }
      throw error;
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product_variant.created',
      entityType: 'product_variant',
      entityId: created.id,
      after: { product_id: productId, options: dto.options },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toVariantPayload(await this.findWithRelationsOrThrow(created.id));
  }

  async update(id: string, actor: AuthenticatedUser, dto: UpdateVariantDto, requestContext: RequestContext) {
    const loaded = await this.findByIdOrThrow(id);
    const attributeValues = dto.attribute_values ?? [];

    if (dto.options !== undefined) {
      assertWellFormedOptions(dto.options);
    }
    if (attributeValues.length > 0) {
      const product = await this.requireProduct(loaded.productId);
      await this.assertAttributeValuesValid(product.categoryId, attributeValues);
    }

    const data: Prisma.ProductVariantUncheckedUpdateManyInput = {};
    if (dto.options !== undefined) {
      data.options = dto.options as Prisma.InputJsonValue;
      data.optionsHash = computeOptionsHash(dto.options);
    }

    let claim: { count: number };
    try {
      claim = await this.prisma.$transaction(async (tx) => {
        const result = await tx.productVariant.updateMany({
          where: { id, version: dto.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (result.count > 0) {
          for (const entry of attributeValues) {
            await tx.productAttributeValue.upsert({
              where: {
                variantId_categoryAttributeId: {
                  variantId: id,
                  categoryAttributeId: entry.category_attribute_id,
                },
              },
              create: {
                variantId: id,
                categoryAttributeId: entry.category_attribute_id,
                value: entry.value as Prisma.InputJsonValue,
              },
              update: { value: entry.value as Prisma.InputJsonValue },
            });
          }
        }
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw duplicateOptionsError();
      }
      throw error;
    }

    if (claim.count === 0) {
      throw new InvalidStateTransitionError('Variant was modified by another request; reload and retry.');
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product_variant.updated',
      entityType: 'product_variant',
      entityId: id,
      before: { options: loaded.options },
      after: { options: dto.options ?? loaded.options },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toVariantPayload(await this.findWithRelationsOrThrow(id));
  }

  async submit(id: string, actor: AuthenticatedUser, requestContext: RequestContext) {
    const loaded = await this.findByIdOrThrow(id);
    const product = await this.requireProduct(loaded.productId);

    const [requiredAttributes, existingValues] = await Promise.all([
      this.prisma.categoryAttribute.findMany({
        where: { categoryId: product.categoryId, required: true },
      }),
      this.prisma.productAttributeValue.findMany({
        where: { variantId: id },
        select: { categoryAttributeId: true },
      }),
    ]);
    const providedIds = new Set(existingValues.map((v) => v.categoryAttributeId));
    const missingKeys = requiredAttributes
      .filter((attr) => !providedIds.has(attr.id))
      .map((attr) => attr.key);

    if (missingKeys.length > 0) {
      throw new ValidationError('Required category attributes are missing.', {
        missing_attribute_keys: missingKeys,
      });
    }

    const claim = await this.prisma.productVariant.updateMany({
      where: { id, status: { in: NON_TERMINAL_STATUSES } },
      data: { status: 'PENDING_REVIEW', version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new InvalidStateTransitionError('Variant is not in a submittable state.');
    }

    await this.prisma.moderationCase.create({
      data: { entityType: 'product_variant', entityId: id },
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product_variant.submitted',
      entityType: 'product_variant',
      entityId: id,
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toVariantPayload(await this.findWithRelationsOrThrow(id));
  }
}
