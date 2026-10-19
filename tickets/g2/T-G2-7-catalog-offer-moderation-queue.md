# T-G2-7 — Catalog & offer moderation queue

**Requirement refs:** TZ §07 (blueprint `CAT-012` "moderation" = canonical `CAT-007`), §12 (`ADM-003` Product moderation — folded here, same "ADM-00X folds into a sibling capability's ticket" pattern `T-G1-5` already used for `ADM-002`/`SEL-009` — see `docs/traceability.md`'s G2 ticket mapping note), §29 (Product/Offer state machines — the actual approve/reject/needs-changes transitions), §34 (Moderator can review seller/catalog but cannot post ledger). Requirement IDs: `CAT-007`, `ADM-003` (folded). Milestone: G2.

**Forward reference (DES, non-authoritative):** DES-015's admin "Global Catalog & GTIN Conflicts; Offers & Moderation" screens need a two-pane before/after diff and a compulsory reject-reason — this ticket's `moderation_decisions` request/response shape carries both already.

**Migration:** none.

## Goal
Let a `MODERATOR` move a product/variant from `PENDING_REVIEW` to `PUBLISHED`/`CHANGES_REQUESTED`/`REJECTED`, and an offer from `PENDING_REVIEW` to `ACTIVE`/`INACTIVE`/`REJECTED`, via the generic `moderation_cases`/`moderation_decisions` tables, with a compulsory reason on any non-approval outcome.

## Files likely touched
- `apps/api/src/modules/catalog/moderation/` (exact module home — `catalog` vs. `admin-audit` — left to backend-dev's own design pass; the generic case/decision tables already live in `admin-audit`'s schema placement from `T-G2-1`)

## How we'll know it's done
- `catalog:moderate`/`offer:moderate` permissions (seeded to `MODERATOR` per `T-G2-1`) gate every decision endpoint — `403` for `SUPPORT_AGENT`, `200` for `MODERATOR`.
- `CHANGES_REQUESTED`/`REJECTED` require a non-empty reason; the submitting seller/admin can read it back via the product's or offer's own `GET`.
- A product cannot reach `PUBLISHED`, and an offer cannot reach `ACTIVE`, without passing through this moderation decision at least once — proven by a test attempting to skip straight from `DRAFT`/`PENDING_REVIEW` to the published/active state via any other code path and getting `409 INVALID_STATE_TRANSITION`.
- Moderation decisions are audit-logged (reusing `audit_logs`, same convention as `T-G1-5`) and are themselves never updated/deleted (`moderation_decisions` has no `updated_at`/`version`, same immutability shape as `SellerContract`/`AuditLog`).
- `version` checked, not just present, on the product/variant/offer row being moderated — 409 on stale version if the underlying resource changed between queue-fetch and decision.
- "Price changes generate audit" (TZ §07 acceptance) is proven by asserting an `audit_logs` row exists on `T-G2-5`'s price-history-writing path, cross-checked (not duplicated) by this ticket's own moderation-decision audit test.

## Owner role
`backend-dev`

## Depends on
T-G2-3, T-G2-5
