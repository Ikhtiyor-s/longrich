# T-G2-5 — Seller offers CRUD + append-only price history

**Requirement refs:** TZ §07 (blueprint `CAT-008` "seller offers/price history" splits into canonical `CAT-005` Offers + `CAT-009` Price history), §29 (Offer `DRAFT→PENDING_REVIEW→ACTIVE`, may be `INACTIVE`/`SUSPENDED`), §28 (offer `price_minor` positive BIGINT — tiyin, 1 so'm = 100 tiyin per TZ §04 — seller SKU unique per seller), §31 (`POST /v1/seller/offers {variant_id,seller_sku,price_minor,currency,fulfillment_mode}` → 201). Requirement IDs: `CAT-005`, `CAT-009`. Milestone: G2.

**Forward reference (DES, non-authoritative):** DES-007's "offer comparison" needs, per offer: seller display name, listed price, delivery window/fee (G6 — not available yet), stock availability (G3 — not available yet), `fulfillment_mode`, seller reputation (not built yet). This ticket's offer response reserves those fields as explicit not-yet-available placeholders (same `"NOT_AVAILABLE"` convention `T-G1-7` already established) rather than omitting them, so G7 doesn't renegotiate the shape later. DES-012/EXT-002 query price history by 7/30/90/365-day windows — `offer_price_history` indexing anticipates that access pattern.

**Migration:** none.

## Goal
Let a seller's `OWNER`/`MANAGER` member create/update/suspend offers against existing global variants, enforcing price/SKU rules, writing an append-only price-history row on every price change, gated on the owning seller being `ACTIVE`.

## Files likely touched
- `apps/api/src/modules/offers/`

## How we'll know it's done
- `POST /v1/seller/offers` (requires an `Idempotency-Key`, reusing `commerce.idempotency_keys` exactly as already established, per TZ §04's convention) creates a `DRAFT`/`PENDING_REVIEW` offer without ever cloning the referenced product/variant row — "adding seller offer doesn't clone global product" proven by asserting product/variant row counts are unchanged.
- `seller_offers(seller_id, sku)` unique per seller — two different sellers can reuse the same SKU string; one seller cannot reuse their own.
- `price_minor` must be a positive BIGINT; zero/negative rejected `422`; no floating-point path exists anywhere in the price-handling code.
- Every `price_minor` change on an existing offer writes a new `offer_price_history` row (old, new, `changed_at`, actor) and never updates/deletes a prior row — proven by a test that changes price three times and asserts three immutable rows.
- Creating/activating an offer while the owning seller is not `ACTIVE` is rejected — "seller cannot publish while non-ACTIVE" (TZ §29) enforced here for the first time against a real resource.
- `version` is checked, not just present, on every offer `PATCH` — 409 on stale version, exercised by a concurrent-update test (two `PATCH`es racing, only one succeeds) — explicit regression guard per the G1 QA TOCTOU finding.
- A seller attempting to `GET`/`PATCH` another seller's offer gets `403` (the `OwnershipGuard`/`SellerPermissionGuard` pair reused exactly as `T-G1-4` established, no new ownership mechanism invented).
- `GET /v1/catalog/variants/{id}/offers` (public) returns only offers whose status is `ACTIVE` and whose owning seller is `ACTIVE` — "inactive offers hidden" (TZ §05) and "forbidden seller edit returns 403" both proven.

## Owner role
`backend-dev`

## Depends on
T-G2-3, T-G1-4, T-G1-5
