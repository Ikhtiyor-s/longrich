# T-G2-1 — Global Catalog & Offers schema + migrations: categories, products, variants, identifiers, offers, media, moderation case tables

**Requirement refs:** TZ §07 (MODUL M03 — GLOBAL CATALOG & OFFERS — DB table list and rules), §12 (M08 — `moderation_cases`/`moderation_decisions`, listed in TZ but never built in G0; first real tables land here since `T-G2-6`/`T-G2-7` need them), §28 (GTIN checksum, variant uniqueness, product title 3..255, offer `price_minor` positive BIGINT, seller SKU unique per seller, category attribute validation types), §29 (Product DRAFT→PENDING_REVIEW→PUBLISHED; Offer DRAFT→PENDING_REVIEW→ACTIVE), §30 (DB physical standard), ADR-001 (module boundaries: `catalog`/`offers`; `pricing` stays an untouched stub — "introduced when checkout needs it," G2 does not need real pricing-rule logic beyond a literal `price_minor` field). Requirement IDs covered (schema only — behavior lands in later tickets): `CAT-001..010` (canonical numbering per `docs/traceability.md`), plus `ADM-003` (schema only). Milestone: G2.

**Migration:** NEW Prisma migration. Every other G2 ticket builds on it and adds no migration of its own, except `T-G2-8` which adds its own additive migration for import-specific tables not in TZ §07's literal list.

## Goal
Add the catalog/offers domain tables — `categories`, `category_attributes`, `brands`, `products`, `product_variants`, `product_identifiers`, `product_attribute_values`, `seller_offers`, `offer_price_history`, `product_media`, `product_merge_cases`, `moderation_cases`, `moderation_decisions` — plus supporting enums and seed fixtures, replacing the `catalog`/`offers` empty stub folders (ADR-001 placeholders) with real Prisma-backed providers. No controllers yet.

## Files likely touched
- `prisma/schema.prisma` — new models + enums (`CategoryStatus`, `ProductStatus`, `VariantStatus`, `OfferStatus`, `IdentifierType`, `MediaModerationStatus`, `MergeCaseStatus`, generic `ModerationEntityType`/decision outcome handling on `moderation_cases`/`moderation_decisions`)
- `prisma/migrations/000X_catalog_offers/migration.sql` (generated)
- `prisma/seed.ts` — extend: (a) 2 nested categories, each with 1 required + 1 optional `category_attributes` row, as fixtures later G2 tickets' tests reuse; (b) new permissions `catalog:category:manage`, `catalog:moderate`, `catalog:merge:approve`, `offer:moderate`, wired via the existing `admin_role_permissions` mechanism, no new mechanism invented — `catalog:moderate`/`offer:moderate` granted to the existing seeded `MODERATOR`; `catalog:category:manage`/`catalog:merge:approve` granted `SUPER_ADMIN`-only as the narrowest-safe-default (TZ never names who manages categories or approves merges — same framing as `docs/open-questions.md` #28's `seller:suspend` precedent, reassignable later with no code change)
- `apps/api/src/modules/catalog/catalog.module.ts`, `apps/api/src/modules/offers/offers.module.ts` — stop being empty stubs. `apps/api/src/modules/pricing/pricing.module.ts` is deliberately NOT touched in G2.

## How we'll know it's done
- `prisma migrate dev` runs clean on a fresh Postgres and is idempotent on a second apply.
- UUID PK, `timestamptz` UTC, `updated_at`+`version` on every mutable table (`categories`, `category_attributes`, `brands`, `products`, `product_variants`, `seller_offers`, `product_merge_cases`) — NOT on `product_identifiers`, `offer_price_history`, or `moderation_decisions`, which are append-only (same immutability shape as `SellerContract`/`AuditLog` from G0/G1).
- `categories` self-references `parent_id` for nested taxonomy; unique `slug`; a generic boolean/config "requires additional certification" flag exists at category level (per `docs/open-questions.md` #7's own stated interim — no specific category is pre-seeded as restricted).
- `products.canonical_id` is a nullable self-referencing FK modeling the merge-redirect pattern (`CAT-006`, built out in `T-G2-6`) — a merged-away product is never deleted, only redirected.
- `seller_offers.price_minor` is BIGINT with a positive-value CHECK; `seller_offers(seller_id, sku)` unique (seller SKU unique per seller, TZ §28); `seller_offers(seller_id, variant_id)` hot index named exactly as TZ §18/§30 list it. `fulfillment_mode` and `currency` are VARCHAR validated against an app-level allowlist, not native Prisma enums — WMS/fulfillment-mode values aren't finalized until G3/G6 and currency is UZS-only for MVP (TZ §01) but kept extensible, same reasoning as G1's `legal_type` extensibility decision.
- `product_identifiers(type, value)` hot index exists exactly as TZ §18/§30 name it.
- `category_attributes` stores its validation rule (required/enum/numeric-range/unit/localization) as JSON, consistent with ADR-001's "JSON only for snapshots/versioned configs" allowance — not ad hoc relational columns per rule type.
- `moderation_cases`/`moderation_decisions` are created here for the first time (TZ §12 lists them, G0 did not build them) as a generic `entity_type`/`entity_id` polymorphic pair, reusable by `T-G2-6` (merge-case decisions) and `T-G2-7` (catalog/offer moderation) without a second parallel decision-tracking table.
- Decision stated explicitly: **OpenSearch is NOT required for G2.** Every list/browse endpoint this milestone builds queries Postgres directly behind cursor pagination and `(category_id, status)`-style composite indexes, consistent with ADR-001's "resource permitting" OpenSearch profile — full-text search relevance tuning stays out of G2 scope.
- Migration test passes on a fresh DB and on a DB with only G0+G1 migrations already applied.

## Owner role
`backend-dev`

## Depends on
T-G1-1
