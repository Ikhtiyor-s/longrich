import type { Seller } from '@prisma/client';

export function toSellerPayload(seller: Seller) {
  return {
    id: seller.id,
    status: seller.status,
    legal_type: seller.legalType,
    tax_id: seller.taxId,
    legal_name: seller.legalName,
    display_name: seller.displayName,
    description: seller.description,
    logo_object_key: seller.logoObjectKey,
    working_hours: seller.workingHours,
    delivery_terms: seller.deliveryTerms,
    created_at: seller.createdAt.toISOString(),
    updated_at: seller.updatedAt.toISOString(),
  };
}
