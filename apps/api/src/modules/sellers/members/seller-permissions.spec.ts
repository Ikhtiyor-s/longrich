import { sellerRoleHasPermission } from './seller-permissions';

describe('sellerRoleHasPermission', () => {
  it('OWNER has seller:members:manage', () => {
    expect(sellerRoleHasPermission('OWNER', 'seller:members:manage')).toBe(true);
  });

  it('MANAGER does not have seller:members:manage (OWNER-only in this ticket)', () => {
    expect(sellerRoleHasPermission('MANAGER', 'seller:members:manage')).toBe(false);
  });

  it('OPERATOR does not have seller:members:manage', () => {
    expect(sellerRoleHasPermission('OPERATOR', 'seller:members:manage')).toBe(false);
  });

  // TZ §34: "Seller operator can manage only seller-scoped orders under
  // assignment; no payout or bank data." Real bank/payout endpoints land in
  // T-G1-8, but the lookup table they will gate against already denies
  // OPERATOR today, proven here rather than asserted by a future ticket.
  it('OPERATOR does not have seller:bank:manage even with an otherwise-valid session', () => {
    expect(sellerRoleHasPermission('OPERATOR', 'seller:bank:manage')).toBe(false);
  });

  it('OPERATOR does not have seller:payout:manage even with an otherwise-valid session', () => {
    expect(sellerRoleHasPermission('OPERATOR', 'seller:payout:manage')).toBe(false);
  });

  it('OWNER has seller:bank:manage and seller:payout:manage (contrast case, proves the table is real, not a blanket deny)', () => {
    expect(sellerRoleHasPermission('OWNER', 'seller:bank:manage')).toBe(true);
    expect(sellerRoleHasPermission('OWNER', 'seller:payout:manage')).toBe(true);
  });

  it('MANAGER does not have seller:bank:manage or seller:payout:manage', () => {
    expect(sellerRoleHasPermission('MANAGER', 'seller:bank:manage')).toBe(false);
    expect(sellerRoleHasPermission('MANAGER', 'seller:payout:manage')).toBe(false);
  });

  // T-G1-6: seller:profile:manage is OWNER/MANAGER, unlike every other code
  // above (OWNER-only) — proves the table supports a real MANAGER grant, not
  // a blanket "MANAGER always empty" shortcut.
  it('OWNER has seller:profile:manage', () => {
    expect(sellerRoleHasPermission('OWNER', 'seller:profile:manage')).toBe(true);
  });

  it('MANAGER has seller:profile:manage', () => {
    expect(sellerRoleHasPermission('MANAGER', 'seller:profile:manage')).toBe(true);
  });

  it('OPERATOR does not have seller:profile:manage', () => {
    expect(sellerRoleHasPermission('OPERATOR', 'seller:profile:manage')).toBe(false);
  });

  // T-G1-7: offer/inventory/order permission surface, registered ahead of
  // G2/G3/G4/G6's real endpoints so nothing redesigns seller-side RBAC later.
  it('OWNER has seller:offers:manage, seller:inventory:view, and seller:orders:view', () => {
    expect(sellerRoleHasPermission('OWNER', 'seller:offers:manage')).toBe(true);
    expect(sellerRoleHasPermission('OWNER', 'seller:inventory:view')).toBe(true);
    expect(sellerRoleHasPermission('OWNER', 'seller:orders:view')).toBe(true);
  });

  it('MANAGER has seller:offers:manage, seller:inventory:view, and seller:orders:view', () => {
    expect(sellerRoleHasPermission('MANAGER', 'seller:offers:manage')).toBe(true);
    expect(sellerRoleHasPermission('MANAGER', 'seller:inventory:view')).toBe(true);
    expect(sellerRoleHasPermission('MANAGER', 'seller:orders:view')).toBe(true);
  });

  // TZ §02: seller operator is "pick/dispatch limited" — can view stock and
  // the order queue, but cannot manage the offer catalog.
  it('OPERATOR has seller:inventory:view and seller:orders:view but not seller:offers:manage', () => {
    expect(sellerRoleHasPermission('OPERATOR', 'seller:inventory:view')).toBe(true);
    expect(sellerRoleHasPermission('OPERATOR', 'seller:orders:view')).toBe(true);
    expect(sellerRoleHasPermission('OPERATOR', 'seller:offers:manage')).toBe(false);
  });

  // T-G1-8: seller:finance:view gates GET /v1/seller/finance/summary and GET
  // /v1/seller/bank-accounts — OWNER/MANAGER, unlike seller:bank:manage
  // (OWNER-only) — TZ §34 only excludes OPERATOR from bank/payout data, it
  // never excludes MANAGER.
  it('OWNER and MANAGER have seller:finance:view, OPERATOR does not', () => {
    expect(sellerRoleHasPermission('OWNER', 'seller:finance:view')).toBe(true);
    expect(sellerRoleHasPermission('MANAGER', 'seller:finance:view')).toBe(true);
    expect(sellerRoleHasPermission('OPERATOR', 'seller:finance:view')).toBe(false);
  });
});
