// VARCHAR app-allowlists (prisma/schema.prisma's own comment on
// seller_offers.currency/fulfillment_mode) — neither docs/architecture/
// api-contract-g2.md nor the TZ source enumerates a full value list for
// either column; the contract's only example values ("UZS", "SELLER_WAREHOUSE")
// are the only ones named anywhere. Kept deliberately narrow (one value
// each) rather than guessing a wider set, same MVP-scope reasoning the
// contract itself gives for currency ("UZS for MVP") — flagged in the
// implementation report as a judgment call, not a confirmed business list.
// Widening either array later is additive, no migration needed (both
// columns are plain VARCHAR, not native Prisma enums).
export const OFFER_CURRENCIES = ['UZS'] as const;
export type OfferCurrency = (typeof OFFER_CURRENCIES)[number];

export const OFFER_FULFILLMENT_MODES = ['SELLER_WAREHOUSE'] as const;
export type OfferFulfillmentMode = (typeof OFFER_FULFILLMENT_MODES)[number];

export const OFFER_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'REJECTED',
] as const;
export type OfferStatusValue = (typeof OFFER_STATUSES)[number];
