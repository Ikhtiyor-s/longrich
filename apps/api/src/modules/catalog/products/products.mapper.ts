import type { Brand, ModerationDecision, Product, ProductMedia } from '@prisma/client';
import { toBrandRefPayload } from '../brands/brands.mapper';
import { emptyOffersSummary, toMediaRefPayload, toVariantPayload } from '../variants/variants.mapper';
import type { VariantWithRelations } from '../variants/variants.mapper';

function toModerationDecisionPayload(decision: ModerationDecision | null) {
  if (!decision) {
    return null;
  }
  return {
    outcome: decision.outcome,
    reason: decision.reason,
    decided_at: decision.decidedAt.toISOString(),
  };
}

export type ProductListRow = Product & { brand: Brand | null; media: ProductMedia[] };

// Public list item — intentionally smaller than the detail payload (no
// variants/attribute_values/latest_moderation_decision), per
// api-contract-g2.md's GET /v1/catalog/products example shape. cover_media
// is pre-filtered by the caller to APPROVED media only (public-safe) before
// this mapper ever sees it.
export function toProductListItemPayload(product: ProductListRow) {
  const cover = product.media[0] ?? null;
  return {
    id: product.id,
    category_id: product.categoryId,
    brand: toBrandRefPayload(product.brand),
    title: product.title,
    status: product.status,
    cover_media: cover ? { object_key: cover.objectKey, position: cover.position } : null,
    offers_summary: emptyOffersSummary(),
  };
}

export type ProductDetailRow = Product & {
  brand: Brand | null;
  variants: VariantWithRelations[];
  media: ProductMedia[];
};

export function toProductDetailPayload(
  product: ProductDetailRow,
  latestModerationDecision: ModerationDecision | null,
) {
  return {
    id: product.id,
    category_id: product.categoryId,
    brand: toBrandRefPayload(product.brand),
    title: product.title,
    description: product.description,
    status: product.status,
    canonical_id: product.canonicalId,
    variants: product.variants.map(toVariantPayload),
    media: product.media.map(toMediaRefPayload),
    offers_summary: emptyOffersSummary(),
    latest_moderation_decision: toModerationDecisionPayload(latestModerationDecision),
    created_at: product.createdAt.toISOString(),
    updated_at: product.updatedAt.toISOString(),
    version: product.version,
  };
}
