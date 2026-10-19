# T-G2-3 — Global product & variant lifecycle (incl. brand and media)

**Requirement refs:** TZ §07 (blueprint `CAT-003` global product, `CAT-004` variants, `CAT-007` brand — folded here, no standalone canonical ID — and `CAT-009` images/video, which maps to canonical `CAT-010` Media; all three share one lifecycle/table family and one moderation gate, see `docs/traceability.md`'s G2 ticket mapping note), §29 (Product `DRAFT→PENDING_REVIEW→PUBLISHED`; `CHANGES_REQUESTED`/`REJECTED`/`SUSPENDED`/`ARCHIVED`), §28 (title 3..255, variant uniqueness, sanitized description, images JPEG/PNG/WebP with moderation). Requirement IDs: `CAT-002`, `CAT-003`, `CAT-010`. Milestone: G2.

**Forward reference (DES, non-authoritative — API-shape awareness only, G7 builds the actual screens):** DES-005 (buyer home product-card fields: title, image, brand, availability), DES-007 (product-detail: gallery, variant-attribute diff, "Texnik ma'lumotlar" tab needs GTIN+MXIK from `T-G2-4`, sanitized long description). This ticket's product/variant response carries brand name, a media array (`object_key`/`position`/moderation status), and resolved attribute values so DES-007's eventual G7 build doesn't have to re-derive the shape.

**Migration:** none.

## Goal
CRUD for canonical products (incl. brand) and their variants, with attribute-value entry validated against `T-G2-2`'s `category_attributes` schema, moving through `DRAFT→PENDING_REVIEW→PUBLISHED` (the actual approve/reject decision lands in `T-G2-7`; this ticket builds the entity and the submit-for-review transition only), plus product media upload reusing `T-G1-3`'s signed-URL + swappable `MalwareScanAdapter` pattern (no second adapter invented).

## Files likely touched
- `apps/api/src/modules/catalog/products/`
- `apps/api/src/modules/catalog/variants/`
- `apps/api/src/modules/catalog/brands/`
- `apps/api/src/modules/catalog/media/`

## How we'll know it's done
- Product title length 3..255 enforced; description stored sanitized, never raw HTML (TZ §28).
- Variant uniqueness: two variants of the same product cannot share the same `options` combination.
- Required `category_attributes` (from `T-G2-2`) block a variant's `DRAFT→PENDING_REVIEW` submission with `422` and a details list naming the missing attribute keys — "required attrs block publication" (TZ §07 acceptance) proven here.
- `GET /v1/catalog/products/{id}` includes variants + brand + media + resolved attribute values; the public-offers field the TZ §31 contract line expects is reserved in the shape now and populated once `T-G2-5` lands.
- Media upload stores only an object-storage key (no bytes in Postgres, ADR-001), reuses the `T-G1-3` `MalwareScanAdapter` mock, and starts `PENDING` moderation (global image moderation per TZ §07) — actual approve/reject lands in `T-G2-7`.
- `version` checked, not just present, on every product/variant `PATCH` — 409 on stale version, explicit regression guard per the G1 QA TOCTOU finding.
- A seller (non-admin caller) attempting to create/edit a product/variant directly gets `403` — sellers only ever attach offers (`T-G2-5`) to existing variants, never author canonical product data, per TZ §07's "adding seller offer doesn't clone global product" rule.
- List endpoint is a direct Postgres query behind cursor pagination (`category_id`/`status` composite index) — no OpenSearch dependency, consistent with `T-G2-1`'s explicit decision.

## Owner role
`backend-dev`

## Depends on
T-G2-1, T-G2-2
