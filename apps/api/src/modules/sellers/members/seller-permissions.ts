import type { SellerMemberRole } from '@prisma/client';

// Keyed exactly like admin RBAC's "resource:action" permission codes
// (common/decorators/require-permission.decorator.ts) but resolved from the
// caller's seller_members.role rather than a seeded admin_role_permissions
// grant — this is T-G1-4's resolution of docs/open-questions.md #30's
// "small, generic seller-role-keyed check" option, kept in this module (not
// common/) because SellerMemberRole is a seller concept, not a generic one.
// seller:bank:manage is wired to a real endpoint as of T-G1-8
// (POST /v1/seller/bank-accounts, OWNER-only per TZ §34 "owner can propose
// bank detail changes"). seller:payout:manage still has no real endpoint —
// payouts are G5/top-level finance-module scope (ADR-001 module 11) — so it
// stays a real lookup waiting for that future endpoint, not a placeholder.
// seller:finance:view (T-G1-8) gates GET /v1/seller/finance/summary and GET
// /v1/seller/bank-accounts: OWNER/MANAGER per the ticket's own done-criteria
// for the summary endpoint, extended to the bank-accounts GET too so TZ
// §34's "no payout or bank data" carve-out for OPERATOR is decided once
// here rather than re-derived per endpoint — this module's own default for
// every other GET (members/profile/dashboard) is membership-only/any-role,
// but TZ explicitly names bank data as an OPERATOR exception, which is why
// this code (not the no-gate default) applies to both finance GETs.
// seller:profile:manage (T-G1-6) is the first code MANAGER actually holds —
// TZ §34 gives manager "own offers/inventory/prices," and a shop's public
// profile/settings is the same tier of day-to-day storefront operation, not
// a members/bank/payout-grade privilege reserved to OWNER.
// seller:offers:manage/seller:inventory:view/seller:orders:view (T-G1-7) have
// no real endpoint yet (Catalog/Offers is G2, Inventory is G3, Orders is
// G4/G6, all still empty ADR-001 stub folders) — same "real lookup, not a
// placeholder" intent as seller:bank:manage/seller:payout:manage above, so
// whichever ticket adds the first real offers/inventory/orders endpoint
// attaches to this table instead of re-deciding seller-side RBAC. TZ §02's
// seller operator is "pick/dispatch limited" (can view/act on assigned
// orders and stock, not manage the offer catalog itself), so OPERATOR holds
// the two :view codes but not seller:offers:manage.
export type SellerPermissionCode =
  | 'seller:members:manage'
  | 'seller:bank:manage'
  | 'seller:payout:manage'
  | 'seller:finance:view'
  | 'seller:profile:manage'
  | 'seller:offers:manage'
  | 'seller:inventory:view'
  | 'seller:orders:view';

const SELLER_ROLE_PERMISSIONS: Record<SellerMemberRole, readonly SellerPermissionCode[]> = {
  OWNER: [
    'seller:members:manage',
    'seller:bank:manage',
    'seller:payout:manage',
    'seller:finance:view',
    'seller:profile:manage',
    'seller:offers:manage',
    'seller:inventory:view',
    'seller:orders:view',
  ],
  // TZ §34 describes manager as able to "manage ... staff subject to grant" —
  // that grant mechanism doesn't exist yet and is explicitly out of scope
  // (ticket requires OWNER-only invite/promote/demote); MANAGER stays empty
  // for members/bank/payout here until a future ticket defines what "subject
  // to grant" means, but does hold seller:profile:manage (T-G1-6), the
  // offer/inventory/order codes (T-G1-7), and seller:finance:view (T-G1-8) —
  // TZ §34 only excludes OPERATOR from bank/payout data, never MANAGER.
  MANAGER: [
    'seller:profile:manage',
    'seller:offers:manage',
    'seller:inventory:view',
    'seller:orders:view',
    'seller:finance:view',
  ],
  // TZ §02/§34: operator is pick/dispatch limited — can view stock and the
  // order queue it's assigned to, but cannot manage the offer catalog
  // (pricing/listing is an owner/manager decision).
  OPERATOR: ['seller:inventory:view', 'seller:orders:view'],
};

export function sellerRoleHasPermission(
  role: SellerMemberRole,
  code: SellerPermissionCode,
): boolean {
  return SELLER_ROLE_PERMISSIONS[role].includes(code);
}
