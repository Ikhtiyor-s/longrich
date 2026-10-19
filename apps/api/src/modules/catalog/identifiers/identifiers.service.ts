import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type IdentifierType, type ProductIdentifier, type ProductVariant } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ValidationError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { isValidGtinChecksum } from './gtin-checksum';
import { CreateIdentifierDto } from './dto/create-identifier.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

const CHECKSUM_TYPES: readonly IdentifierType[] = ['GTIN', 'EAN', 'UPC'];

function toIdentifierPayload(identifier: ProductIdentifier) {
  return {
    id: identifier.id,
    variant_id: identifier.variantId,
    type: identifier.type,
    value: identifier.value,
    classification_version: identifier.classificationVersion,
    created_at: identifier.createdAt.toISOString(),
  };
}

interface ProductForTieBreak {
  id: string;
  createdAt: Date;
}

@Injectable()
export class IdentifiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // Exported for cross-module/DI lookup (T-G2-8's import row processor,
  // per api-contract-g2.md's file structure — the signature is pinned there
  // even though nothing in this ticket's own scope calls it yet).
  async findByTypeValue(type: IdentifierType, value: string): Promise<ProductIdentifier | null> {
    return this.prisma.productIdentifier.findFirst({ where: { type, value } });
  }

  private async requireVariant(variantId: string): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) {
      throw new NotFoundException('Variant not found.');
    }
    return variant;
  }

  private assertValueValid(
    type: IdentifierType,
    value: string,
    classificationVersion: string | undefined,
  ): void {
    if (CHECKSUM_TYPES.includes(type)) {
      if (!isValidGtinChecksum(value)) {
        throw new ValidationError('Barcode value failed GS1 check-digit validation.', {
          value: ['failed GTIN/EAN/UPC checksum validation'],
        });
      }
      return;
    }

    // MXIK: open-questions.md #32 — no live register exists to validate
    // against, so no checksum is applied; only presence of
    // classification_version is enforced here.
    if (!classificationVersion) {
      throw new ValidationError('classification_version is required for MXIK identifiers.', {
        classification_version: ['required for type MXIK'],
      });
    }
  }

  // Deterministic regardless of which side's insert attempt triggers
  // detection (api-contract-g2.md's Prisma field reference, ProductMergeCase
  // tie-break rule): earlier created_at wins; ties broken by lower id.
  private pickWinnerLoser(
    a: ProductForTieBreak,
    b: ProductForTieBreak,
  ): { winningProductId: string; losingProductId: string } {
    const aFirst =
      a.createdAt.getTime() !== b.createdAt.getTime()
        ? a.createdAt.getTime() < b.createdAt.getTime()
        : a.id < b.id;
    return aFirst
      ? { winningProductId: a.id, losingProductId: b.id }
      : { winningProductId: b.id, losingProductId: a.id };
  }

  private async findOrCreateMergeCase(
    winningProductId: string,
    losingProductId: string,
    identifierType: string,
    identifierValue: string,
  ) {
    const key = {
      winningProductId_losingProductId_identifierValue: {
        winningProductId,
        losingProductId,
        identifierValue,
      },
    };

    const existing = await this.prisma.productMergeCase.findUnique({ where: key });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.productMergeCase.create({
        data: { winningProductId, losingProductId, identifierType, identifierValue },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Lost a create race against another concurrent conflict detection
        // for the exact same triple — the row now exists, fetch it instead
        // of inserting a second one.
        return this.prisma.productMergeCase.findUniqueOrThrow({ where: key });
      }
      throw error;
    }
  }

  async create(
    variantId: string,
    actor: AuthenticatedUser,
    dto: CreateIdentifierDto,
    requestContext: RequestContext,
  ) {
    const variant = await this.requireVariant(variantId);
    this.assertValueValid(dto.type, dto.value, dto.classification_version);

    const existing = await this.prisma.productIdentifier.findFirst({
      where: { type: dto.type, value: dto.value },
    });

    if (existing && existing.variantId !== variantId) {
      const [thisProduct, otherVariant] = await Promise.all([
        this.prisma.product.findUniqueOrThrow({ where: { id: variant.productId } }),
        this.prisma.productVariant.findUniqueOrThrow({ where: { id: existing.variantId } }),
      ]);
      const otherProduct = await this.prisma.product.findUniqueOrThrow({
        where: { id: otherVariant.productId },
      });

      const { winningProductId, losingProductId } = this.pickWinnerLoser(thisProduct, otherProduct);
      const mergeCase = await this.findOrCreateMergeCase(
        winningProductId,
        losingProductId,
        dto.type,
        dto.value,
      );

      await this.auditService.record({
        actor: { id: actor.id, type: 'USER' },
        action: 'product_identifier.conflict_detected',
        entityType: 'product_merge_case',
        entityId: mergeCase.id,
        after: { identifier_type: dto.type, identifier_value: dto.value, variant_id: variantId },
        requestId: requestContext.requestId,
        traceId: requestContext.traceId,
      });

      return {
        status: 'CONFLICT_DETECTED' as const,
        merge_case_id: mergeCase.id,
        identifier_type: dto.type,
        identifier_value: dto.value,
      };
    }

    if (existing) {
      // Exact same (type, value) re-posted against the same variant it is
      // already attached to. Returned as an idempotent success instead of a
      // second append-only row — neither the ticket nor the contract covers
      // this exact case (both only describe the cross-variant conflict
      // path), so this is a judgment call, flagged in the implementation
      // report.
      return toIdentifierPayload(existing);
    }

    const created = await this.prisma.productIdentifier.create({
      data: {
        variantId,
        type: dto.type,
        value: dto.value,
        classificationVersion: dto.classification_version ?? null,
        createdBy: actor.id,
      },
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'product_identifier.created',
      entityType: 'product_identifier',
      entityId: created.id,
      after: { variant_id: variantId, type: dto.type, value: dto.value },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toIdentifierPayload(created);
  }

  // Public read: only surfaces identifiers for a PUBLISHED variant whose
  // product is also PUBLISHED (api-contract-g2.md). An unknown variant id
  // is 404 (same as every other by-id lookup in this module); a known but
  // not-yet-published variant returns an empty array rather than leaking
  // whether admin-only identifiers exist — no ticket text states this
  // exact split, flagged as a judgment call in the implementation report.
  async listPublic(variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { status: true } } },
    });
    if (!variant) {
      throw new NotFoundException('Variant not found.');
    }
    if (variant.status !== 'PUBLISHED' || variant.product.status !== 'PUBLISHED') {
      return [];
    }

    const identifiers = await this.prisma.productIdentifier.findMany({
      where: { variantId },
      orderBy: { createdAt: 'asc' },
    });
    return identifiers.map((identifier) => ({
      type: identifier.type,
      value: identifier.value,
      classification_version: identifier.classificationVersion,
    }));
  }
}
