import type { CategoryAttribute, ProductAttributeValue, ProductMedia, ProductVariant } from '@prisma/client';

// offers_summary is reserved with this exact zero-valued shape from day one
// per api-contract-g2.md ("T-G2-5 never changes this shape, only starts
// populating it with live aggregates") — no SellerOffer rows can exist yet
// in this milestone (the offers module's write endpoints are T-G2-5, not
// built here), so every G2-3 response hardcodes the zero case rather than
// querying a module that doesn't exist yet.
export function emptyOffersSummary() {
  return { active_offer_count: 0, lowest_price_minor: null as string | null, currency: null as string | null };
}

export function toAttributeValuePayload(
  attributeValue: ProductAttributeValue & { categoryAttribute: CategoryAttribute },
) {
  return {
    category_attribute_id: attributeValue.categoryAttributeId,
    key: attributeValue.categoryAttribute.key,
    value: attributeValue.value,
  };
}

export function toMediaRefPayload(media: ProductMedia) {
  return {
    id: media.id,
    object_key: media.objectKey,
    position: media.position,
    moderation_status: media.moderationStatus,
  };
}

export type VariantWithRelations = ProductVariant & {
  attributeValues: Array<ProductAttributeValue & { categoryAttribute: CategoryAttribute }>;
  media: ProductMedia[];
};

export function toVariantPayload(variant: VariantWithRelations) {
  return {
    id: variant.id,
    product_id: variant.productId,
    options: variant.options,
    status: variant.status,
    attribute_values: variant.attributeValues.map(toAttributeValuePayload),
    media: variant.media.map(toMediaRefPayload),
    offers_summary: emptyOffersSummary(),
    created_at: variant.createdAt.toISOString(),
    updated_at: variant.updatedAt.toISOString(),
    version: variant.version,
  };
}
