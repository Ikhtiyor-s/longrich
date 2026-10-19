import type { Seller, SellerApplication, SellerContract } from '@prisma/client';

export function toApplicationPayload(seller: Seller, application: SellerApplication) {
  return {
    id: application.id,
    seller_id: seller.id,
    status: application.status,
    legal_type: seller.legalType,
    tax_id: seller.taxId,
    legal_name: seller.legalName,
    display_name: seller.displayName,
    contacts: application.contacts,
    reason: application.reason,
    reviewer_id: application.reviewerId,
    created_at: application.createdAt.toISOString(),
    updated_at: application.updatedAt.toISOString(),
  };
}

export function toContractPayload(contract: SellerContract) {
  return {
    id: contract.id,
    seller_id: contract.sellerId,
    version: contract.version,
    signed_key: contract.signedKey,
    accepted_at: contract.acceptedAt.toISOString(),
  };
}
