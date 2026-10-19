# T-G2-6 — GTIN duplicate-candidate detection & merge-proposal review

**Requirement refs:** TZ §07 (blueprint `CAT-010` "duplicates review/merge" = canonical `CAT-006`), rule "GTIN conflict creates review case, not destructive merge"; §12 (`moderation_cases`/`moderation_decisions`, reused here as the generic case/decision mechanism rather than inventing a second parallel one); §31 (`POST /v1/admin/catalog/merge-proposals/{id}/approve`). Requirement ID: `CAT-006`. Milestone: G2.

**Reconciliation note (per `docs/traceability.md`'s extensions-conflicts section #1):** this ticket's `product_merge_cases` table is named/shaped to match EXT-006's own proposed table name exactly, so EXT-006 (R1, barcode-scan-to-offer UX) extends it later instead of building a second, parallel merge-case model.

**Migration:** none (`product_merge_cases` + `moderation_cases`/`moderation_decisions` already created in `T-G2-1`).

## Goal
Automatically open a `product_merge_cases` row (`PENDING`) whenever `T-G2-4`'s conflict check detects two variants claiming the same GTIN, and give an admin a review endpoint to approve (redirect the losing product's `canonical_id` to the winning product, never delete the row) or reject (dismiss, both products stay independent) the proposal.

## Files likely touched
- `apps/api/src/modules/catalog/merge-cases/`

## How we'll know it's done
- A detected GTIN conflict creates exactly one `product_merge_cases` row — idempotent on repeated detection of the same pair, not one row per attempt.
- `POST /v1/admin/catalog/merge-proposals/{id}/approve` sets the losing product's `canonical_id` to the winning product's id, re-points any `seller_offers` referencing the losing product's variants to the winning product's matching variant where a clean 1:1 match exists, and leaves an explicit manual-resolution flag where it doesn't (never guesses a mapping) — the losing product row is never deleted.
- "Merging preserves historical orders" is proven at the level available in G2 (no `orders` table exists until G4): the losing product/variant rows remain queryable by id after merge, satisfying the no-delete invariant a future order snapshot will rely on — PR note explicitly defers the full order-level acceptance test to G4, same pattern `T-G1-5` used for deferring seller-suspension's order-cancellation acceptance.
- `REJECT` requires a non-empty reason, recorded via `moderation_decisions` (`entity_type='product_merge_case'`) — the same generic mechanism `T-G2-7` uses, no second decision-recording mechanism invented.
- `version` checked, not just present, on the merge-case row during approve/reject — 409 on stale version.
- Non-admin caller gets `403`.

## Owner role
`backend-dev`

## Depends on
T-G2-1, T-G2-4, T-G2-5
