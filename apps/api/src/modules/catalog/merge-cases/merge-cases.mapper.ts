import type { ProductMergeCase } from '@prisma/client';

export function toMergeCasePayload(mergeCase: ProductMergeCase) {
  return {
    id: mergeCase.id,
    winning_product_id: mergeCase.winningProductId,
    losing_product_id: mergeCase.losingProductId,
    identifier_type: mergeCase.identifierType,
    identifier_value: mergeCase.identifierValue,
    status: mergeCase.status,
    manual_resolution_required: mergeCase.manualResolutionRequired,
    created_at: mergeCase.createdAt.toISOString(),
    updated_at: mergeCase.updatedAt.toISOString(),
    version: mergeCase.version,
  };
}

// POST .../approve's own response shape (api-contract-g2.md) — narrower
// than the full merge-case payload, plus the repoint-outcome counters that
// only exist as a result of the approve action itself. unmatched_offer_count
// is an additive extension alongside unmatched_variant_count (same naming
// pattern, not an unrelated new field) — it surfaces a per-offer
// (seller_id, sku) collision during repoint that is distinct from a
// variant having no clean 1:1 options match at all.
export function toApproveResultPayload(
  mergeCase: ProductMergeCase,
  repointedOfferCount: number,
  unmatchedVariantCount: number,
  unmatchedOfferCount: number,
) {
  return {
    id: mergeCase.id,
    status: mergeCase.status,
    manual_resolution_required: mergeCase.manualResolutionRequired,
    repointed_offer_count: repointedOfferCount,
    unmatched_variant_count: unmatchedVariantCount,
    unmatched_offer_count: unmatchedOfferCount,
    version: mergeCase.version,
  };
}
