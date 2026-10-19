import type { SellerOffer } from '@prisma/client';

// DB/Prisma column stays `sku`; the wire field is `seller_sku`
// (api-contract-g2.md "Inconsistencies resolved" #2) — this mapper is where
// the rename happens, same pattern as every other camelCase/snake_case
// mapping in this codebase. price_minor is the first BigInt field in this
// codebase (api-contract-g2.md "price_minor wire representation") — always
// serialized as a JSON string of digits, never a JS number.
export function toOfferPayload(offer: SellerOffer) {
  return {
    id: offer.id,
    seller_id: offer.sellerId,
    variant_id: offer.variantId,
    seller_sku: offer.sku,
    price_minor: offer.priceMinor.toString(),
    currency: offer.currency,
    fulfillment_mode: offer.fulfillmentMode,
    status: offer.status,
    created_at: offer.createdAt.toISOString(),
    updated_at: offer.updatedAt.toISOString(),
    version: offer.version,
  };
}

// Public comparison view (GET /v1/catalog/variants/{id}/offers) — no
// version/internal fields, per api-contract-g2.md's exact item shape.
export type PublicOfferRow = Pick<
  SellerOffer,
  'id' | 'sellerId' | 'sku' | 'priceMinor' | 'currency' | 'fulfillmentMode'
>;

export function toPublicOfferPayload(offer: PublicOfferRow) {
  return {
    id: offer.id,
    seller_id: offer.sellerId,
    seller_sku: offer.sku,
    price_minor: offer.priceMinor.toString(),
    currency: offer.currency,
    fulfillment_mode: offer.fulfillmentMode,
  };
}
