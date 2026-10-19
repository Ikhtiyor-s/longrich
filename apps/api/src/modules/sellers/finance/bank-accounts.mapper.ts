import type { SellerBankAccount } from '@prisma/client';

const VISIBLE_SUFFIX_LENGTH = 4;

// Masking happens here, in the mapper layer, exactly once, on the way out
// of this module — never relying on the client to not look (this ticket's
// own instruction). If the raw value is at or below the visible-suffix
// length, every character is masked rather than exposing the whole thing.
export function maskBankReference(reference: string): string {
  if (reference.length <= VISIBLE_SUFFIX_LENGTH) {
    return '*'.repeat(reference.length);
  }
  return (
    '*'.repeat(reference.length - VISIBLE_SUFFIX_LENGTH) + reference.slice(-VISIBLE_SUFFIX_LENGTH)
  );
}

// rawReference is deliberately never read onto this payload, masked or
// otherwise — only maskBankReference()'s output does, so there is no field
// on the returned object a future caller could destructure back into the
// raw value.
export function toBankAccountPayload(bankAccount: SellerBankAccount) {
  return {
    id: bankAccount.id,
    seller_id: bankAccount.sellerId,
    masked_reference: maskBankReference(bankAccount.rawReference),
    verified: bankAccount.verified,
    reviewer_id: bankAccount.reviewerId,
    reviewed_at: bankAccount.reviewedAt ? bankAccount.reviewedAt.toISOString() : null,
    created_at: bankAccount.createdAt.toISOString(),
    updated_at: bankAccount.updatedAt.toISOString(),
  };
}
