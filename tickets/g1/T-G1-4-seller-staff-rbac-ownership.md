# T-G1-4 — Seller staff/team RBAC: owner/manager/operator roles, first real seller_id OwnershipGuard wiring

**Requirement refs:** TZ §02 (Seller Owner/Manager/Operator persona boundaries), §06 (`SEL-005` staff & RBAC — canonical spreadsheet ID; blueprint's own numbering calls this `SEL-006`), §34 (security/RBAC matrix — "Seller owner can propose bank detail changes, manage members with no privilege escalation"; "Seller manager can manage own offers/inventory/prices and staff subject to grant"; "Seller operator can manage only seller-scoped orders under assignment; no payout or bank data"). Requirement ID: `SEL-005`. Milestone: G1.

**Migration:** None. Uses `seller_members` from `T-G1-1` — this ticket is pure RBAC/permission-wiring, the first to actually exercise `OwnershipGuard`/`@RequireOwnership` from `T-G0-5` against a real `seller_id`-scoped resource instead of a fake fixture.

## Goal
Let a seller OWNER manage staff membership (invite/remove/change role) for their own seller, enforcing no-privilege-escalation, with the creating user of `T-G1-2`'s application automatically recorded as the first OWNER.

## Files likely touched
- `apps/api/src/modules/sellers/members/` — controller, service, DTOs
- Reuses `apps/api/src/common/guards/ownership.guard.ts`, `apps/api/src/common/decorators/require-ownership.decorator.ts`, and the `PermissionGuard`/`@RequirePermission` pattern from G0 — extended here with a seller-role-keyed check (design note below), not a parallel mechanism

## Design note — flagged, not silently resolved (see `docs/open-questions.md` #30)
G0's `OwnershipGuard` compares a single resolved owner id against `request.user.id`. A `seller_id`-scoped resource's real "owner" is a **set** of `seller_members` rows, not one id. This ticket must explicitly decide — and document in its PR — whether the `OwnershipResolver` function itself performs the seller-membership lookup and returns the caller's own id when authorized (reusing `OwnershipGuard` unmodified), or whether the guard needs a small, generic (not seller-specific) extension. Either way, the fix must not regress G0's existing fake-fixture test (`ownership.guard.spec.ts`).

## How we'll know it's done
- Creating a seller application (`T-G1-2`) automatically inserts the creating user as a `seller_members` row with role `OWNER`.
- `GET /v1/seller/members` lists only the caller's own seller's members; cross-seller access → `403`.
- `POST /v1/seller/members` (invite) and role-change endpoints require `OWNER`; a `MANAGER` attempting to invite/promote → `403`.
- No-privilege-escalation proven explicitly: an `OWNER` cannot be demoted by a `MANAGER`; a `MANAGER` cannot grant `OWNER` or `MANAGER` to anyone (TZ §34 "no privilege escalation") — a dedicated test attempts exactly this and gets `403`, not a silent downgrade.
- `OPERATOR` role is recorded but this ticket does not yet need a real resource for it to operate on (seller-scoped orders don't exist until G4/G6) — operator's actual order-scoping enforcement is explicitly deferred, stated as such in the ticket's completion note rather than implied as done.
- `seller:bank:*`/payout-adjacent actions are proven unreachable for `OPERATOR` even with an otherwise-valid session (TZ §34 "no payout or bank data" for operator) — this is a permission-check unit test, the real bank endpoints land in `T-G1-8`.

## Owner role
`backend-dev`

## Depends on
T-G1-1, T-G1-2
