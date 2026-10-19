# API Contract — G2 (Global Catalog & Offers)

**Status: FROZEN.** This is the single source of truth for `T-G2-2` through `T-G2-8` (behavior) and `T-G2-1` (the schema these all read/write — see "Prisma field reference" below, which fills gaps `T-G2-1`'s own ticket text left open). Backend-dev implements against this exactly. This document is what makes the two declared parallel pairs — **`T-G2-4` + `T-G2-5`** and **`T-G2-6` + `T-G2-7`** — safe to build concurrently: every route, DTO field name, error code, permission code, and cross-module call either of a pair might otherwise invent independently is pinned here first. Changing a shape after this ships goes back through the architect per the conflict-resolution protocol (minor clarification → `## Clarifications` entry; real change → escalate to PM).

Source: `docs/source/longrich-tz-master-blueprint.txt` §07 (M03 table list/rules), §12 (M08 moderation tables), §28 (field-level validation rules), §29 (state machines), §30 (DB physical standard), §31 (API contract lines), `docs/adr/ADR-001-architecture.md` (module boundaries, cross-module write rule), `docs/architecture/g0-design-notes.md` + `docs/architecture/api-contract-g0.md` (conventions this document inherits), `tickets/g2/T-G2-1..T-G2-8`, `docs/traceability.md` (G2 ticket mapping), `docs/open-questions.md` #32 (MXIK). API root is `/v1`.

## Conventions inherited unchanged from G0 (not re-litigated here)

snake_case JSON; success envelope `{ "data": <payload>, "meta": { "request_id": "<uuid>" } }`; error envelope `{ "error": { "code", "message", "details" }, "request_id" }`; `request_id` server-generated and echoed; ISO-8601 UTC timestamps; UUID v4 ids; `Idempotency-Key` header optional-but-supported on every mutating POST via `IdempotencyService.run(scope, key, body, handler)` (`apps/api/src/common/idempotency/idempotency.service.ts`); `version` optimistic-concurrency columns are **checked**, not just present, via the same compare-and-swap `updateMany({ where: { id, version, ...stateGuard }, data: { ..., version: { increment: 1 } } })` idiom used throughout G0/G1 (`SessionService.rotateRefreshToken`, `OtpService.rejectAttempt`, `ApplicationsService.update`, `SuspensionService.suspend`) — a lost race returns `409 INVALID_STATE_TRANSITION`, the same code used for an actually-invalid state transition (this codebase does not have a separate `CONFLICT`/`STALE_VERSION` code; G0/G1 never introduced one and this document does not either, for consistency).

## New conventions this milestone introduces (first use in the codebase — frozen here, not left to each ticket to invent)

### Cursor pagination (first use anywhere in this codebase)

G0/G1 had no paginated list endpoint (`documents.list`, `members.list` return plain arrays). G2 is the first milestone with real list/browse volume (`T-G2-1`'s own text: "cursor pagination," repeated in `T-G2-2`/`T-G2-3`). Frozen shape, used by **every** G2 list endpoint below unless stated otherwise:

- Query params: `cursor` (opaque string, optional — omit for the first page), `limit` (optional integer, default `20`, min `1`, max `100`; out-of-range → `422 VALIDATION_ERROR`).
- Response payload (the value `ResponseEnvelopeInterceptor` wraps as `data`):
  ```json
  { "items": [ /* ... */ ], "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNi0xMC0xOFQxMDowMDowMFoiLCJpZCI6Ii4uLiJ9" }
  ```
  `next_cursor` is `null` on the last page.
- Cursor encoding: base64url of `{"created_at":"<iso>","id":"<uuid>"}`. Ordering is **`(created_at ASC, id ASC)` for every G2 list endpoint, with no exception** — including `GET /v1/catalog/categories`, which returns a **flat** list of category rows (each carrying its own `parent_id`); the client reconstructs the tree client-side. "Nested taxonomy" (`T-G2-2`) describes the data model (`categories.parent_id` self-reference), not a server-side nested-JSON response shape — flagged explicitly because the ticket's wording ("returns the nested tree") could otherwise be misread as requiring recursive JSON.
- Filters are plain additional query params (e.g. `category_id`, `status`) applied before the cursor window, never inside the cursor token itself.

### `price_minor` wire representation: JSON **string**, not number (first BIGINT field in this codebase)

`seller_offers.price_minor` and every derived field (`offer_price_history.old_price_minor`/`new_price_minor`, catalog-import row prices) are Postgres `BIGINT`. JSON numbers lose precision above 2^53; rather than rely on "tiyin amounts never realistically get that large," this contract freezes `price_minor` (and any sibling `*_price_minor` field) as a **JSON string of digits** on the wire in both requests and responses (e.g. `"price_minor": "4500000"`), parsed server-side to a JS `BigInt`/Prisma `BigInt`. This is a new precedent (G0/G1 have no BIGINT fields) and applies to every G2 endpoint that carries a price.

### Cross-module boundary: `catalog` ↔ `offers` (first two mutually-dependent business modules in this codebase)

ADR-001's binding rule: a module may read another module's data only via that module's exported DI service, synchronously, inside one transaction — never direct Prisma access to another module's models, never a raw cross-module join. G0/G1 never had two business modules needing each other in the same request; G2 does, twice:

1. **`offers` module creating/updating a `seller_offers` row MUST validate the target variant via `catalog`'s exported `VariantsService.findPublishedOrThrow(variantId)` (DI-injected into `OffersModule`), never via a direct `tx.productVariant.findUnique(...)` call from inside `offers`.**
2. **`T-G2-6` merge-case approval, which re-points `seller_offers.variant_id` from the losing product's variants to the winning product's matching variants, is a WRITE to offers-module-owned data from catalog-module code.** This MUST go through an exported `OffersService.repointVariantOwnership(tx, fromVariantId, toVariantId): Promise<{ movedCount: number; unmatchedCount: number }>` method, injected into `CatalogModule`, called **inside the same `prisma.$transaction` callback** that flips `products.canonical_id` — ADR-001's "synchronous DI call inside one transaction boundary" clause applies exactly (same shape as checkout calling `InventoryService.reserve(...)`). `MergeCasesService` MUST NOT call `tx.sellerOffer.updateMany(...)` itself.

## Permission codes — resolved (real inconsistency found and fixed, see "Inconsistencies resolved" below)

| Code | Resource:action parse | Seeded to | Gates |
|---|---|---|---|
| `category:manage` | `category` / `manage` | `SUPER_ADMIN` only | `T-G2-2` category + category-attribute CRUD |
| `catalog:moderate` | `catalog` / `moderate` | `MODERATOR` | `T-G2-7` product/variant/media moderation decisions |
| `merge_case:approve` | `merge_case` / `approve` | `SUPER_ADMIN` only | `T-G2-6` merge-proposal approve/reject |
| `offers:moderate` | `offers` / `moderate` | `MODERATOR` | `T-G2-7` offer moderation decisions |
| `seller:offers:manage` *(already seeded in `T-G1-1`/`T-G1-7`, OWNER+MANAGER)* | n/a (seller-role lookup, not admin RBAC) | OWNER, MANAGER (not OPERATOR) | `T-G2-5` seller-offers CRUD, `T-G2-8` bulk import trigger — **reused as-is, no new seller-permission code added** |

All four new **admin** codes gate via the existing `PermissionGuard`/`@RequirePermission` (`apps/api/src/common/guards/permission.guard.ts`), composed exactly like `SuspensionController`/`ModerationController`: `@UseGuards(JwtAuthGuard, PermissionGuard)` + `@RequirePermission('<code>')`, no `OwnershipGuard` involved (these are platform-wide admin resources, not seller_id-scoped). `seller:offers:manage` gates via the existing `SellerPermissionGuard`/`@RequireSellerPermission` + `MemberAccessGuard`/`OwnershipGuard` trio exactly as `MembersController.updateRole` composes them.

## Error codes used in G2 (reusing the existing `ApiError` enum — no new error-code strings introduced)

| HTTP | `code` | Used by |
|---|---|---|
| 401 | `UNAUTHENTICATED` | any protected route, no/expired token |
| 403 | `FORBIDDEN` | missing admin permission, missing seller permission, non-member seller caller, seller attempting direct product/variant authorship |
| 404 | `NOT_FOUND` *(generic, via `NotFoundException` → `HttpExceptionFilter.codeForStatus`, same as G1)* | unknown category/product/variant/offer/merge-case/import-job id |
| 422 | `VALIDATION_ERROR` | title length, GTIN checksum failure, missing MXIK `classification_version`, non-positive `price_minor`, duplicate category slug, cyclic `parent_id`, malformed cursor/limit, missing required `category_attributes` on variant submit (with `details.missing_attribute_keys`) |
| 409 | `INVALID_STATE_TRANSITION` | stale `version` (CAS loss) on any G2 mutating PATCH/decision endpoint; skipping a required moderation step; committing an import job twice; suspending/activating an offer from a status that doesn't allow it |
| 409 | `DUPLICATE_REQUEST` | `Idempotency-Key` replay with a different body, or a concurrent in-flight call with the same key |
| 202 | *(success, not an error — see `T-G2-4` identifier-conflict endpoint)* | GTIN/EAN/UPC/MXIK conflict detected, merge case opened/reused |

No new `ApiErrorCode` string is added to `apps/api/src/common/http/api-error.ts` by this milestone — every G2 scenario maps onto a code the enum already defines.

---

## Prisma field reference (fills gaps `T-G2-1`'s own text left open — architect additions, flagged individually, not a rewrite of the ticket)

`T-G2-1` names the table list and a handful of specific columns/indexes but does not give a complete field list for every table, and its own "mutable gets `updated_at`+`version`, append-only doesn't" rule has two tables it forgot to classify. This section is the frozen field list backend-dev implements `T-G2-1`'s migration against; where it fills a gap, that is called out inline.

**`categories`** (mutable: `updated_at`+`version`) — `id, parent_id (nullable self-FK), slug (unique), name, status (CategoryStatus: ACTIVE|ARCHIVED — architect addition: ticket names the enum but never gives its values; two values chosen for symmetry with every other "never delete, archive instead" convention in this project), requires_certification (boolean, default false), created_at, updated_at, version`. Index `(parent_id)`, unique `(slug)`.

**`category_attributes`** (mutable) — `id, category_id (FK), key, label, type (VARCHAR app-allowlist: TEXT|ENUM|NUMERIC_RANGE|UNIT|LOCALIZED_TEXT — VARCHAR not a Prisma enum, same extensibility reasoning as `legal_type`/`fulfillment_mode` since TZ never finalizes the full rule-type list), required (boolean, default false), validation (Json, nullable — the rule payload: `{enum_values:[...]}` / `{min,max}` / `{unit}` / `{locales:[...]}`), created_at, updated_at, version`. Unique `(category_id, key)`.

**`brands`** — `id, name (unique), slug (unique), logo_object_key (text, nullable), created_at, updated_at, version`. No moderation state — brands are a plain admin-managed lookup, not a reviewed entity.

**`products`** (mutable) — `id, category_id (FK), brand_id (nullable FK), title (varchar, 3..255), description (text, sanitized), status (ProductStatus: DRAFT|PENDING_REVIEW|PUBLISHED|CHANGES_REQUESTED|REJECTED|SUSPENDED|ARCHIVED), canonical_id (nullable self-FK, merge-redirect target), created_at, updated_at, version`. Index `(category_id, status)`.

**`product_variants`** (mutable) — `id, product_id (FK), options (Json — the attribute-combination, e.g. {"size":"L","color":"red"}), options_hash (varchar(64), sha256 of the canonicalized/key-sorted `options` JSON — **architect addition**: Postgres has no reliable native unique-index semantics over raw JSON for this; `options_hash` is the mechanism that actually makes "two variants of the same product cannot share the same options combination" enforceable), status (VariantStatus, same value set as ProductStatus), created_at, updated_at, version`. Unique `(product_id, options_hash)`.

**`product_attribute_values`** (mutable — **architect addition, gap-fill**: `T-G2-1`'s own text lists this table but omits it from *both* its "gets `updated_at`+`version`" list *and* its "append-only, no `version`" list; it is editable data entered before a variant's first submit, so it follows the ticket's own general rule "every mutable table gets `updated_at`+`version`," not the append-only exception) — `id, variant_id (FK), category_attribute_id (FK), value (Json), created_at, updated_at, version`. Unique `(variant_id, category_attribute_id)`.

**`product_identifiers`** (append-only, confirmed by `T-G2-1`, no `updated_at`/`version`) — `id, variant_id (FK), type (IdentifierType: GTIN|EAN|UPC|MXIK), value (varchar), classification_version (varchar, nullable — MXIK rows only, per open-questions.md #32), created_by (uuid), created_at`. Index `(type, value)` exactly as `T-G2-1` names it. **Being append-only means there is no edit/delete path for a wrongly-entered identifier in G2 — flagged under "Out of scope" below, not silently assumed.**

**`seller_offers`** (mutable) — `id, seller_id (FK), variant_id (FK), sku (varchar — Prisma/DB column name; see "Inconsistencies resolved" for why the wire field is named differently), price_minor (BIGINT, CHECK > 0), currency (VARCHAR app-allowlist, UZS for MVP), fulfillment_mode (VARCHAR app-allowlist), status (OfferStatus: DRAFT|PENDING_REVIEW|ACTIVE|INACTIVE|SUSPENDED|REJECTED), created_at, updated_at, version`. Unique `(seller_id, sku)`. Index `(seller_id, variant_id)` exactly as `T-G2-1`/TZ §18/§30 name it.

**`offer_price_history`** (append-only, confirmed) — `id, offer_id (FK), old_price_minor (BIGINT, nullable — null on the row written at offer creation), new_price_minor (BIGINT), changed_by (uuid), changed_at (timestamptz)`. Index `(offer_id, changed_at)` — anticipates EXT-002's 7/30/90/365-day query pattern per `T-G2-5`'s own acceptance note, though no read endpoint for it ships in G2 (see "Out of scope").

**`product_media`** (mutable — **architect addition, gap-fill, same reasoning as `product_attribute_values`**: listed by `T-G2-1` but omitted from both lists; `moderation_status` and `position` both change after creation) — `id, product_id (FK), variant_id (nullable FK — a variant-specific image, e.g. one per color), object_key (text), position (int), mime_type (varchar), moderation_status (MediaModerationStatus: PENDING|APPROVED|REJECTED), created_at, updated_at, version`.

**`product_merge_cases`** (mutable, confirmed) — `id, winning_product_id (FK), losing_product_id (FK), identifier_type (varchar), identifier_value (varchar), status (MergeCaseStatus: PENDING|APPROVED|REJECTED), manual_resolution_required (boolean, default false), created_at, updated_at, version`. Unique `(winning_product_id, losing_product_id, identifier_value)`. **Tie-break rule for "winning" vs "losing" (architect addition — needed to make "idempotent on repeated detection" actually deterministic regardless of detection order):** the product with the earlier `created_at` is `winning_product_id`; ties broken by lower `id`. The conflict-detection query MUST compute this consistently so a second detection of the same pair resolves to the same row instead of attempting a reversed-direction duplicate insert.

**`moderation_cases`** (mutable; no CAS-tested `version` in G2 — the version check G2 tests live on the underlying product/variant/offer row, not on this row, so `version` is omitted here) — `id, entity_type (varchar: 'product'|'product_variant'|'product_media'|'offer'), entity_id (uuid), status (varchar: OPEN|RESOLVED), opened_at (timestamptz), resolved_at (nullable timestamptz), created_at, updated_at`. Index `(entity_type, status)` — backs the moderation-queue list. **Role clarified (architect addition — `T-G2-1` names the table, `T-G2-7` uses it, but no ticket states exactly when a row is created):** a row is created the moment the underlying entity transitions into `PENDING_REVIEW` (from `T-G2-3`'s product/variant submit, `T-G2-5`'s offer submit, or `T-G2-3`'s media-clean-scan-into-PENDING step), and is marked `RESOLVED` the moment `T-G2-7` records a decision. `product_merge_cases` does **not** get a mirrored `moderation_cases` row — it already serves as its own queue (`status=PENDING` is the queue filter), consistent with `T-G2-6`'s own text never mentioning one.

**`moderation_decisions`** (append-only, confirmed) — `id, entity_type (varchar), entity_id (uuid), moderation_case_id (nullable FK — null for merge-case decisions, which have no `moderation_cases` row), outcome (varchar — e.g. 'PUBLISHED'/'CHANGES_REQUESTED'/'REJECTED' for products, 'ACTIVE'/'INACTIVE'/'REJECTED' for offers, 'APPROVED'/'REJECTED' for merge cases), reason (text, nullable — required by DTO validation on every non-approval outcome), decided_by (uuid), decided_at (timestamptz), created_at`.

---

## `T-G2-1` — schema/migrations

No HTTP surface. Delivers every table above plus seed data (2 nested categories with 1 required + 1 optional `category_attributes` row each; the 4 new admin permission codes from the table above, wired to `admin_role_permissions` exactly as `T-G0-3` established). `catalog.module.ts`/`offers.module.ts` stop being empty ADR-001 stub folders; `pricing.module.ts` stays untouched.

---

## `T-G2-2` — Category taxonomy + attributes

### `GET /v1/catalog/categories`
**Auth:** none (public). Cursor-paginated per the convention above. Query: `cursor?`, `limit?`, `parent_id?` (filter to direct children of a given category; omit for all categories flat).

Response `200`:
```json
{
  "data": {
    "items": [
      { "id": "...", "parent_id": null, "slug": "electronics", "name": "Electronics",
        "status": "ACTIVE", "requires_certification": false,
        "created_at": "2026-10-18T10:00:00Z", "updated_at": "2026-10-18T10:00:00Z", "version": 1 }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "..." }
}
```

### `GET /v1/catalog/categories/{id}`
Same shape as one `items[]` element. `404 NOT_FOUND` if unknown.

### `POST /v1/catalog/categories`
**Auth:** `JwtAuthGuard`+`PermissionGuard`, `@RequirePermission('category:manage')`. Idempotency scope `cat:create` (10 chars + 36-char UUID stays well under the `scope` column's 64-char cap — see `T-G1-5`'s own overflow bug for why this is checked explicitly here).

Request: `{ "parent_id": null, "slug": "electronics", "name": "Electronics", "requires_certification": false }`. `slug` required, unique; `parent_id` optional, must not create a cycle (walk the ancestor chain server-side — `422 VALIDATION_ERROR` with `details.parent_id` on a cycle or on an unknown `parent_id`).

Response `201`: category object (same shape as GET). Errors: `422 VALIDATION_ERROR` (duplicate slug, cyclic/unknown parent), `403 FORBIDDEN`.

### `PATCH /v1/catalog/categories/{id}`
Same guard/permission. Body: any subset of `{ slug, name, requires_certification, parent_id, status, version }` — **`version` is required in the body and checked via CAS** (`updateMany({ where: { id, version } })`); `409 INVALID_STATE_TRANSITION` on mismatch. Response `200`: updated category.

### `GET /v1/catalog/categories/{category_id}/attributes`
**Auth:** none (public) — read is public exactly like the category itself; only write is gated. Returns a plain array (not cursor-paginated — the acceptance bar only requires correctness of the rule definition, and a category's attribute count is bounded/small; cursor pagination is reserved for genuinely large collections per the convention above).
```json
{ "data": [ { "id": "...", "category_id": "...", "key": "color", "label": "Color",
  "type": "ENUM", "required": true, "validation": { "enum_values": ["red","blue"] },
  "created_at": "...", "updated_at": "...", "version": 1 } ], "meta": { "request_id": "..." } }
```

### `POST /v1/catalog/categories/{category_id}/attributes`
**Auth/permission:** same as category write. Idempotency scope `cat-attr:create`. Request: `{ "key": "color", "label": "Color", "type": "ENUM", "required": true, "validation": { "enum_values": ["red","blue"] } }`. `type` validated against the allowlist; `validation` shape validated against `type` (e.g. `NUMERIC_RANGE` requires `{min,max}` both present and `min < max`) — `422 VALIDATION_ERROR` with `details.validation` on malformed rule shape. Response `201`.

### `PATCH /v1/catalog/categories/{category_id}/attributes/{id}`
Same guard. Body includes `version`, CAS-checked, `409` on stale. Response `200`.

**Given/When/Then (representative):**
```
Given an existing category with slug "electronics" already taken
When POST /v1/catalog/categories is called with slug "electronics" again
Then HTTP 422 VALIDATION_ERROR is returned with details.slug naming the duplicate,
     and no new category row is created

Given category A has category B as its parent
When PATCH /v1/catalog/categories/{B.id} is called with parent_id = A.id
Then HTTP 422 VALIDATION_ERROR is returned (cycle), and B.parent_id is unchanged
```

**Prisma models:** `Category`, `CategoryAttribute` (read+write, both owned by `catalog` module).

---

## `T-G2-3` — Product/variant/brand/media lifecycle

### `POST /v1/catalog/brands`, `GET /v1/catalog/brands` (public, array), `GET /v1/catalog/brands/{id}`, `PATCH /v1/catalog/brands/{id}`
Same CRUD shape as categories, gated on `category:manage` (brands have no dedicated permission code — reusing the catalog-admin code rather than adding a fifth one, since no ticket text asks for a separate brand-management grant). Idempotency scope `brand:create`.

### `POST /v1/catalog/products`
**Auth:** `category:manage`? — **no.** Product *authorship* is a distinct admin capability from category *taxonomy* management (a real person could manage categories without being trusted to author product catalog content, and vice versa) — gated instead on `catalog:moderate`'s sibling authoring grant. **Resolved here, not left ambiguous:** product/variant/brand/media *creation and editing* (as opposed to the *moderation decision* in `T-G2-7`) is gated on `category:manage` reused as the single "catalog admin" grant — `T-G2-1` seeds only four new codes total and none of them is a dedicated "author products" code, so rather than invent a fifth, `category:manage` is reused for all pre-moderation catalog-admin authoring (categories, attributes, brands, products, variants, media, identifiers). `catalog:moderate`/`offers:moderate` remain reserved exclusively for the `T-G2-7` decision endpoints. A `SUPER_ADMIN` therefore authors catalog content; a `MODERATOR` only ever decides on it — matches TZ §34 ("Moderator can review ... but cannot post ledger," i.e. moderator is a reviewer role, not an author role).

Idempotency scope `prod:create`. Request:
```json
{ "category_id": "...", "brand_id": null, "title": "Wireless Mouse", "description": "<sanitized text>" }
```
`title` length 3..255 (`422` otherwise). `description` is sanitized server-side (strip tags) before storage, never stored raw. Response `201`, status `DRAFT`.

### `GET /v1/catalog/products` (public)
Cursor-paginated. Query: `cursor?, limit?, category_id?`. **Always implicitly filtered to `status=PUBLISHED`, regardless of caller** — there is no `status` query param on this public endpoint; an admin wanting non-published items uses `T-G2-7`'s moderation-queue endpoint instead. Each item:
```json
{ "id": "...", "category_id": "...", "brand": { "id": "...", "name": "..." } | null,
  "title": "...", "status": "PUBLISHED",
  "cover_media": { "object_key": "...", "position": 0 } | null,
  "offers_summary": { "active_offer_count": 2, "lowest_price_minor": "4500000", "currency": "UZS" } }
```

### `GET /v1/catalog/products/{id}` (public)
Full detail — includes `variants[]`, each with `options`, resolved `attribute_values[]` (`{ category_attribute_id, key, value }`), `media[]` (`{ id, object_key, position, moderation_status }`), its own `offers_summary`; plus product-level `brand`, `description`, `media[]`, and a rolled-up `offers_summary` (sum/min across all variants). **`offers_summary` ships with this exact shape from day one** (zero-valued until `T-G2-5` lands, never a `"NOT_AVAILABLE"` placeholder string) — `T-G2-5` never changes this shape, only starts populating it with live aggregates (`COUNT`/`MIN` over `seller_offers WHERE status='ACTIVE' AND seller.status='ACTIVE'`), avoiding a type change later. `latest_moderation_decision: { outcome, reason, decided_at } | null`, resolved via `moderation_decisions` lookup, not a stored column.

### `PATCH /v1/catalog/products/{id}`
`category:manage`. Body: subset of `{ category_id, brand_id, title, description, version }`, CAS-checked. `409` on stale version or on attempting to edit a product whose `status` is `REJECTED`/`ARCHIVED` (terminal — `INVALID_STATE_TRANSITION`).

### `POST /v1/catalog/products/{id}/submit`
`category:manage`. DRAFT → PENDING_REVIEW. Idempotency scope `prod:{id}:submit`. Creates a `moderation_cases` row (`entity_type='product'`). `409 INVALID_STATE_TRANSITION` if not currently DRAFT (or CHANGES_REQUESTED — resubmission after `T-G2-7` feedback, same DRAFT-or-CHANGES_REQUESTED-both-valid pattern `ApplicationsService.submit` already established for sellers).

### `POST /v1/catalog/products/{id}/variants`
`category:manage`. Request: `{ "options": { "size": "L", "color": "red" }, "attribute_values": [ { "category_attribute_id": "...", "value": "red" } ] }`. Server computes `options_hash`; `422` on a duplicate `(product_id, options_hash)`. Response `201`, status `DRAFT`.

### `PATCH /v1/catalog/variants/{id}`
Same permission. Body: subset of `{ options, attribute_values, version }`, CAS-checked.

### `POST /v1/catalog/variants/{id}/submit`
DRAFT (or CHANGES_REQUESTED) → PENDING_REVIEW. Validates every `required=true` `category_attributes` row for the variant's category has a corresponding `product_attribute_values` row; missing ones → `422 VALIDATION_ERROR` with `details.missing_attribute_keys: ["color", ...]`, **no state change on failure**. On success, creates a `moderation_cases` row (`entity_type='product_variant'`).

### `POST /v1/catalog/products/{id}/media`
`category:manage`. Mirrors `T-G1-3`'s `DocumentsController.create` exactly: request `{ "filename", "mime_type", "size_bytes", "variant_id": null }`, response includes `upload_url`/`upload_url_expires_in_seconds` (via the shared `StorageService.createPresignedUploadUrl`). `mime_type` allowlist: `image/jpeg`, `image/png`, `image/webp` (video explicitly out of scope — see "Out of scope"). Row created with `moderation_status` not yet set (no row exists until the file is actually there — mirrors `SellerDocument`'s "row created at POST time, scanned at confirm time" pattern, so `moderation_status` defaults `PENDING` at creation, the "scan" below either keeps it `PENDING` for human moderation or short-circuits it on malware detection).

### `POST /v1/catalog/media/{id}/confirm`
Reuses `T-G1-3`'s `MalwareScanAdapter` (no second adapter). If the scan reports dirty, the media row is rejected outright (`moderation_status='REJECTED'`, never enters the human moderation queue — distinct from a human content-moderation reject). If clean, `moderation_status` stays `PENDING` and **this is the point** a `moderation_cases` row (`entity_type='product_media'`) is created for `T-G2-7` to decide on.

**Given/When/Then (representative):**
```
Given a variant whose category has one required category_attribute ("color") with no
     product_attribute_values row for it yet
When POST /v1/catalog/variants/{id}/submit is called
Then HTTP 422 VALIDATION_ERROR is returned with details.missing_attribute_keys = ["color"],
     and the variant's status remains DRAFT

Given a non-admin (seller) caller with a valid access token
When POST /v1/catalog/products is called
Then HTTP 403 FORBIDDEN is returned — sellers never author global product data (TZ §07)
```

**Prisma models:** `Brand`, `Product`, `ProductVariant`, `ProductAttributeValue`, `ProductMedia`, `ModerationCase` (create only) — all owned/written by `catalog` module.

---

## `T-G2-4` — Barcode/MXIK identifiers (parallel pair with `T-G2-5`)

### `POST /v1/catalog/variants/{id}/identifiers`
`category:manage`. Idempotency scope `ident:{id}:create`. Request:
```json
{ "type": "GTIN", "value": "04006381333931" }
```
or for MXIK:
```json
{ "type": "MXIK", "value": "01234567890123456", "classification_version": "2024.3" }
```
- `type ∈ {GTIN, EAN, UPC, MXIK}`.
- For `GTIN`/`EAN`/`UPC`: `value` validated against the standard GS1 mod-10 check-digit algorithm for its length (8/12/13/14 digits); checksum failure → `422 VALIDATION_ERROR`, **the row is never created**.
- For `MXIK`: no checksum (open-questions.md #32 — no live register to validate against); `classification_version` is **required** (`422` if absent) and stored as a free-text version label, not validated against any external list. No response from this or any other G2 endpoint ever claims an MXIK code is "verified."

**Conflict path (the core acceptance criterion):** if `(type, value)` already exists on a *different* variant, the identifier is **not** attached to this variant. Instead:
- The service looks up or creates one `product_merge_cases` row for the `(winning_product, losing_product, identifier_value)` triple, using the tie-break rule in the Prisma field reference above (deterministic regardless of which variant's insert attempt triggers detection — repeated detection of the same pair never creates a second row).
- Response is `202 Accepted`, not `201`:
  ```json
  { "data": { "status": "CONFLICT_DETECTED", "merge_case_id": "...", "identifier_type": "GTIN",
      "identifier_value": "04006381333931" }, "meta": { "request_id": "..." } }
  ```

Errors: `422 VALIDATION_ERROR` (checksum failure, missing `classification_version`), `403 FORBIDDEN` (non-admin caller).

### `GET /v1/catalog/variants/{id}/identifiers`
**Auth:** public, but **only returns identifiers belonging to a `PUBLISHED` variant whose product is `PUBLISHED`** — unpublished catalog content's identifiers stay admin-only (no separate admin read endpoint is added in G2; admins read identifiers via the product/variant detail payload's eventual extension, out of scope to wire in this milestone since no ticket tests it). Plain array, each item `{ "type": "GTIN", "value": "...", "classification_version": null }`.

**Given/When/Then:**
```
Given variant A already has a verified GTIN "04006381333931"
When POST /v1/catalog/variants/{B.id}/identifiers is called with the same GTIN
     ("04006381333931") where B != A
Then HTTP 202 is returned with status=CONFLICT_DETECTED and a merge_case_id,
     no product_identifiers row is created for B, and a repeat of the exact same
     call does not create a second product_merge_cases row
```

**Prisma models:** `ProductIdentifier` (write), `ProductMergeCase` (create-or-find), `ProductVariant`/`Product` (read, via `catalog`'s own `VariantsService`/`ProductsService` — no cross-module access needed here since both are `catalog`-owned).

---

## `T-G2-5` — Seller offers CRUD + price history (parallel pair with `T-G2-4`)

### `POST /v1/seller/offers`
**Auth:** `JwtAuthGuard` + `MemberAccessGuard` + `OwnershipGuard` + `SellerPermissionGuard`, `@RequireSellerPermission('seller:offers:manage')` — exactly the `MembersController.updateRole` guard composition, applied to a new resource. **`Idempotency-Key` is REQUIRED on this endpoint** (not merely supported) per `T-G2-5`'s own text citing TZ §04's convention for this specific route — missing header → `422 VALIDATION_ERROR` with `details.idempotency_key: ["Idempotency-Key header is required."]`. Idempotency scope `off:create`.

Request (field names frozen exactly as TZ §31 states them — see "Inconsistencies resolved" for the `seller_sku`/`sku` DB-vs-wire naming note):
```json
{ "variant_id": "...", "seller_sku": "SKU-001", "price_minor": "4500000", "currency": "UZS", "fulfillment_mode": "SELLER_WAREHOUSE" }
```
- `variant_id` MUST resolve to a `PUBLISHED` variant (via `catalog`'s exported `VariantsService.findPublishedOrThrow`, per the cross-module boundary rule above) — unpublished/unknown variant → `404 NOT_FOUND`.
- `price_minor`: digit string, parses to `BigInt > 0`; zero/negative/non-numeric → `422 VALIDATION_ERROR`.
- `seller_sku` unique per seller (`seller_offers(seller_id, sku)`) — duplicate for the *same* seller → `422 VALIDATION_ERROR` with `details.seller_sku`; two different sellers reusing the same string is allowed.
- Owning seller MUST be `status=ACTIVE` — otherwise `403 FORBIDDEN` ("seller cannot publish while non-ACTIVE," TZ §29).
- Creates the offer at `status=DRAFT` and writes one `offer_price_history` row (`old_price_minor=null, new_price_minor=<price_minor>`) in the same transaction — **never clones `products`/`product_variants` rows**, proven by row-count assertions per the ticket's own acceptance bar.

Response `201`:
```json
{ "data": { "id": "...", "seller_id": "...", "variant_id": "...", "seller_sku": "SKU-001",
    "price_minor": "4500000", "currency": "UZS", "fulfillment_mode": "SELLER_WAREHOUSE",
    "status": "DRAFT", "created_at": "...", "updated_at": "...", "version": 1 },
  "meta": { "request_id": "..." } }
```

### `POST /v1/seller/offers/{id}/submit`
Same guard trio. DRAFT (or CHANGES_REQUESTED-equivalent `INACTIVE`-after-moderation-decline — see `T-G2-7`) → PENDING_REVIEW. Idempotency scope `off:{id}:submit`. Creates a `moderation_cases` row (`entity_type='offer'`). `403` if owning seller is not `ACTIVE` (re-checked here too — a seller could go `SUSPENDED` between creation and submit).

### `PATCH /v1/seller/offers/{id}`
Same guard trio. Body: subset of `{ seller_sku, price_minor, currency, fulfillment_mode, version }`, CAS-checked (`409` on stale). **Price edits are allowed in any non-terminal status, including `ACTIVE`** — a seller changing price on a live offer does not re-enter moderation (TZ's "offer cannot reach ACTIVE without a moderation decision" only governs the *first* arrival at ACTIVE, not every subsequent price edit). Every actual `price_minor` change (old ≠ new) writes one new `offer_price_history` row in the same transaction as the offer update — proven by the ticket's "three price changes, three immutable rows" test.

### Seller self-service status toggle: `PATCH /v1/seller/offers/{id}` body MAY also include `{ "status": "INACTIVE" | "SUSPENDED" | "ACTIVE" }`
Only these caller-initiated transitions are permitted via this field, enforced server-side as an explicit allow-list (not a free-form status write): `ACTIVE ↔ INACTIVE`, `ACTIVE → SUSPENDED`, `INACTIVE → SUSPENDED`, `SUSPENDED → INACTIVE`. **`DRAFT`, `PENDING_REVIEW`, `REJECTED` are never reachable via this field** — those three transitions exist only via `/submit` (seller) or `T-G2-7`'s decision endpoints (moderator). Any other requested value in this field → `409 INVALID_STATE_TRANSITION`. This is the resolution of `T-G2-5`'s Goal text ("create/update/**suspend** offers") into a concrete, testable mechanism — a single PATCH field with a closed transition table, not a proliferation of per-transition action endpoints (which the ticket's own acceptance bullets never test for).

### `GET /v1/seller/offers/{id}`, `GET /v1/seller/offers?seller_id=...`
Same guard trio (list uses `MemberAccessGuard` resolved from the `seller_id` query param, same shape as `DashboardController`/`MembersController.list`). List is cursor-paginated, filterable by `status`. A seller calling either against another seller's offer → `403 FORBIDDEN`.

### `GET /v1/catalog/variants/{id}/offers` (public)
**Lives in the `offers` module** (reads `seller_offers`, an offers-owned model) **despite its `/v1/catalog/...` URL prefix** — route path and owning module folder are independent, same non-issue as `finance.controller.ts` living in the `sellers` module; flagged explicitly so neither parallel-pair builder assumes URL prefix implies module home. Returns only offers whose own `status='ACTIVE'` **and** whose owning seller's `status='ACTIVE'` — both conditions enforced in the query, not filtered client-side. Cursor-paginated. Each item: `{ id, seller_id, seller_sku, price_minor, currency, fulfillment_mode }` (no `version`/internal fields — this is the public comparison view).

**Given/When/Then:**
```
Given seller A's offer is DRAFT and seller A is ACTIVE
When seller A calls PATCH /v1/seller/offers/{id} with price_minor changed twice,
     then a third time
Then three offer_price_history rows exist for this offer, each immutable, and
     offer.price_minor reflects only the latest value

Given seller B is not a member of seller A
When seller B calls GET /v1/seller/offers/{offerOwnedByA.id}
Then HTTP 403 FORBIDDEN is returned
```

**Prisma models:** `SellerOffer`, `OfferPriceHistory`, `ModerationCase` (create) — owned/written by `offers` module; `ProductVariant`/`Seller` read via each owning module's exported service (cross-module DI, never direct Prisma access).

---

## `T-G2-6` — GTIN duplicate merge review (parallel pair with `T-G2-7`)

### `GET /v1/admin/catalog/merge-proposals`
`category:manage` **or** `merge_case:approve` (either grant can view the queue; only `merge_case:approve` can decide — same "view is broader than decide" pattern `T-G1-5`/`T-G1-8` already use for seller finance). Cursor-paginated, filterable by `status` (default `PENDING`).

### `GET /v1/admin/catalog/merge-proposals/{id}`
Same guard. `404 NOT_FOUND` if unknown.
```json
{ "data": { "id": "...", "winning_product_id": "...", "losing_product_id": "...",
    "identifier_type": "GTIN", "identifier_value": "04006381333931", "status": "PENDING",
    "manual_resolution_required": false, "created_at": "...", "updated_at": "...", "version": 1 },
  "meta": { "request_id": "..." } }
```

### `POST /v1/admin/catalog/merge-proposals/{id}/approve`
**Frozen verbatim by TZ §31.** `@RequirePermission('merge_case:approve')`. Idempotency scope `merge:{id}:approve`. Body: none required.

Effect, in one transaction:
1. Set the losing product's `canonical_id = winning_product_id`. The losing product/variant rows are **never deleted**.
2. Call `OffersService.repointVariantOwnership(tx, losingVariantId, winningVariantId)` (cross-module DI call, per the boundary rule above) for every losing-product variant that has a clean 1:1 match (same `options` shape) on the winning product. Any losing variant **without** a clean match is left untouched and the merge case is updated with `manual_resolution_required = true` — **never guessed**.
3. Set `product_merge_cases.status = APPROVED` (CAS-checked on `version`; `409` on stale).
4. Write a `moderation_decisions` row: `entity_type='product_merge_case', entity_id=<case.id>, outcome='APPROVED', reason=null, moderation_case_id=null` (no `moderation_cases` row exists for merges, per the Prisma field reference above).

Response `200`:
```json
{ "data": { "id": "...", "status": "APPROVED", "manual_resolution_required": false,
    "repointed_offer_count": 3, "unmatched_variant_count": 0, "version": 2 },
  "meta": { "request_id": "..." } }
```

### `POST /v1/admin/catalog/merge-proposals/{id}/reject`
`@RequirePermission('merge_case:approve')`. Idempotency scope `merge:{id}:reject`. Request: `{ "reason": "Not actually the same product." }` — reuses the `DecisionReasonDto` shape (`IsNotEmpty`, `MaxLength(2000)`) exactly as `sellers/moderation/dto/decision-reason.dto.ts` defines it, copied into this module's own `dto/` folder per the "each module owns its own DTO copy" decision in "G2 file structure" below. Empty/missing `reason` → `422 VALIDATION_ERROR`. Sets `status=REJECTED` (CAS-checked), writes `moderation_decisions` (`outcome='REJECTED'`). Both products remain fully independent — `canonical_id` is never touched.

Errors (both endpoints): `403 FORBIDDEN` (non-admin), `404 NOT_FOUND`, `409 INVALID_STATE_TRANSITION` (already decided, or stale `version`).

**Given/When/Then:**
```
Given a PENDING merge case where only 2 of the losing product's 3 variants have a
     clean 1:1 options match on the winning product
When POST /v1/admin/catalog/merge-proposals/{id}/approve is called
Then HTTP 200 is returned with repointed_offer_count reflecting only the matched
     variants' offers, manual_resolution_required = true, and the one unmatched
     variant's offers are left pointing at the (now-redirected) losing product's
     variant, unchanged
```

**Prisma models:** `ProductMergeCase`, `Product` (write `canonical_id`), `ModerationDecision` (write) — all `catalog`-owned; `SellerOffer` write via `offers`' exported `OffersService` (cross-module DI).

---

## `T-G2-7` — Catalog & offer moderation queue (parallel pair with `T-G2-6`)

**Module home — resolved, not left to backend-dev's own pass** (the ticket text explicitly leaves this open; pinned here so the two parallel-pair agents don't each guess differently): product/variant/media moderation lives in `apps/api/src/modules/catalog/moderation/`; offer moderation lives in `apps/api/src/modules/offers/moderation/` — each module's own moderation logic sits beside the entity it decides on, both reading/writing the same shared `moderation_cases`/`moderation_decisions` tables (which live under `admin-audit`'s schema placement from `T-G2-1`, consistent with where `audit_logs` itself is queried from by every module via the shared `AuditService`).

### `GET /v1/admin/catalog/moderation-queue`
`catalog:moderate` **or** `offers:moderate` (either grant can view; see per-decision endpoints below for who may act). Cursor-paginated, filterable by `entity_type ∈ {product, product_variant, product_media, offer}` (omit for all), always `status=OPEN` only — a resolved case is reachable only via the entity's own GET + `latest_moderation_decision`, not through this queue. Each item: `{ id, entity_type, entity_id, opened_at }`.

### Product decisions — `POST /v1/admin/catalog/products/{id}/approve`, `/needs-changes`, `/reject`
`@RequirePermission('catalog:moderate')`. Mirrors `ModerationController`'s three-endpoint shape exactly (approve: no body, idempotency scope `cat-mod:{id}:approve`; needs-changes/reject: body `{ "reason": "..." }` via the local `DecisionReasonDto` copy, idempotency scopes `cat-mod:{id}:needs-changes`/`cat-mod:{id}:reject`). Only valid from `PENDING_REVIEW` — `409 INVALID_STATE_TRANSITION` otherwise, including an attempt to jump straight from `DRAFT` to `PUBLISHED` via any path that bypasses this endpoint (the ticket's own explicit test). On decide: sets `products.status` (PUBLISHED/CHANGES_REQUESTED/REJECTED), resolves the `moderation_cases` row (`status=RESOLVED, resolved_at=now()`), writes `moderation_decisions`, writes `audit_logs` (reusing `AuditService`, same convention as `T-G1-5`). `version` of the product row is checked (CAS) — if the product changed between queue-fetch and decision, `409`.

### Variant decisions — `POST /v1/admin/catalog/variants/{id}/approve`, `/needs-changes`, `/reject`
Identical shape, scoped to `product_variants.status`, idempotency scopes `var-mod:{id}:approve`/`needs-changes`/`reject`.

### Media decisions — `POST /v1/admin/catalog/media/{id}/approve`, `/reject`
Two outcomes only (no "needs changes" for an image — ticket's own "actual approve/reject" wording, no third state tested). Reject body requires `reason`. Idempotency scopes `media-mod:{id}:approve`/`reject`. Sets `product_media.moderation_status`.

### Offer decisions — `POST /v1/admin/offers/moderation/{id}/approve`, `/deactivate`, `/reject`
`@RequirePermission('offers:moderate')`. `approve` (no body) → `ACTIVE`; `deactivate` (body `{reason}`) → `INACTIVE`; `reject` (body `{reason}`) → `REJECTED`. Idempotency scopes `off-mod:{id}:approve`/`deactivate`/`reject`. Only valid from `PENDING_REVIEW`. Same CAS-on-underlying-row, same `moderation_cases`/`moderation_decisions`/`audit_logs` writes.

**Audit cross-check (ticket's own acceptance line, "price changes generate audit"):** this ticket's moderation-decision audit write is a *separate* `audit_logs` row from the one `T-G2-5`'s price-change path already writes on every `PATCH /v1/seller/offers/{id}` price edit — the two are asserted to both exist independently, never collapsed into one.

**Given/When/Then:**
```
Given an offer in PENDING_REVIEW
When a caller with only catalog:moderate (not offers:moderate) calls
     POST /v1/admin/offers/moderation/{id}/approve
Then HTTP 403 FORBIDDEN is returned — the two moderation grants are independent,
     not aliases of each other

Given a product in PENDING_REVIEW whose version the caller's queue-fetch read as 3,
     but a concurrent edit has since bumped it to 4
When POST /v1/admin/catalog/products/{id}/approve is called
Then HTTP 409 INVALID_STATE_TRANSITION is returned, and products.status is unchanged
```

**Prisma models:** `Product`, `ProductVariant`, `ProductMedia`, `ModerationCase`, `ModerationDecision` (catalog-side, `catalog` module); `SellerOffer`, `ModerationCase`, `ModerationDecision` (offer-side, `offers` module — both modules write the shared `ModerationCase`/`ModerationDecision` models directly since those are admin-audit/platform-shared tables every module is expected to write to, same as every module already writes `AuditLog`/`OutboxEvent`, not a violation of the catalog↔offers boundary rule above, which only concerns `catalog`'s and `offers'` *own* domain models).

---

## `T-G2-8` — CSV/XLSX bulk catalog import

Built directly to EXT-005's state machine (`docs/traceability.md`'s reconciliation #2): `UPLOADED → VALIDATING → READY → IMPORTING → COMPLETED/PARTIAL/FAILED`. New, additive migration (its own, per the ticket) for `catalog_import_jobs`, `catalog_import_rows`, `catalog_import_errors`, `catalog_import_templates` — field lists below are this contract's freeze of those tables (not given in the ticket text beyond the state machine itself).

**`catalog_import_jobs`** (mutable) — `id, seller_id (FK), status (ImportJobStatus: UPLOADED|VALIDATING|READY|IMPORTING|COMPLETED|PARTIAL|FAILED), object_key, content_hash (varchar(64), nullable until VALIDATING computes it), total_rows (int, nullable), valid_row_count (int, nullable), error_row_count (int, nullable), created_by (uuid), created_at, updated_at, version`. Unique `(seller_id, content_hash)` **partial** (only enforced where `content_hash IS NOT NULL AND status != 'FAILED'`) — this is the duplicate-upload dedup mechanism.

**`catalog_import_rows`** (append-only outcome per row, written once at commit) — `id, job_id (FK), row_number, action (varchar: 'CREATE_OFFER'|'CREATE_DRAFT_PRODUCT'), seller_offer_id (nullable FK), product_id (nullable FK), created_at`.

**`catalog_import_errors`** (append-only) — `id, job_id (FK), row_number, field, message, created_at`.

### `POST /v1/seller/catalog/imports`
`seller:offers:manage` (reused — **resolved here**: the ticket doesn't name which permission gates this, and rather than add a fifth seller-permission code, this reuses the existing `seller:offers:manage` grant, since a bulk import's end effect is creating offers/draft-products, the same capability tier). Idempotency scope `cat-imp:create`. Request mirrors `T-G1-3`'s document-upload shape: `{ "seller_id": "...", "filename": "catalog.csv", "mime_type": "text/csv", "size_bytes": 204800 }`. Response `201`: `{ id, status: "UPLOADED", upload_url, upload_url_expires_in_seconds }`.

### `POST /v1/seller/catalog/imports/{id}/confirm`
Same permission (ownership resolved the same way as `documents.controller.ts`'s `/confirm`). Idempotency scope `cat-imp:{id}:confirm`. Synchronously flips `status: UPLOADED → VALIDATING` and enqueues a BullMQ job (not inline) that: downloads the object, computes `content_hash`, checks the partial-unique dedup — **if a non-`FAILED` job with the same `(seller_id, content_hash)` already exists, this job is marked `status='COMPLETED'` immediately with `details.duplicate_of_job_id` pointing at the original, and no row parsing happens** — otherwise parses rows, validates each (SKU dedup within the file, identifier lookup via `catalog`'s `IdentifiersService`/`VariantsService` through DI per the boundary rule above), writes `catalog_import_errors` for invalid rows, and sets `status: VALIDATING → READY` (or `FAILED` on an unparseable file). Response `200`: `{ id, status: "VALIDATING" }` (the HTTP response reflects the state **at the moment of the call**, not the eventual outcome — client polls GET for that).

### `GET /v1/seller/catalog/imports/{id}`
Poll endpoint. Response:
```json
{ "data": { "id": "...", "status": "READY", "total_rows": 1000, "valid_row_count": 970,
    "error_row_count": 30, "duplicate_of_job_id": null, "created_at": "...", "updated_at": "..." },
  "meta": { "request_id": "..." } }
```

### `GET /v1/seller/catalog/imports/{id}/errors`
Cursor-paginated. Items: `{ row_number, field, message }`.

### `GET /v1/seller/catalog/imports` (list, own seller's jobs, cursor-paginated, filterable by `status`)

### `POST /v1/seller/catalog/imports/{id}/commit`
Same permission. Idempotency scope `cat-imp:{id}:commit`. **Only valid from `status=READY`** — `409 INVALID_STATE_TRANSITION` otherwise (including a second commit attempt without a matching `Idempotency-Key`, which is the explicit regression guard against double-creating offers on a retried commit). Synchronously flips `READY → IMPORTING`, enqueues a BullMQ job that processes the 970 valid rows: a row matching an existing identifier (via `T-G2-4`'s `(type,value)` lookup, through DI) creates **only** a `seller_offers` row; an unmatched row creates a new `DRAFT` product (`T-G2-3` shape, going through the exact same `category:manage`-authored, `T-G2-7`-moderated path — bulk import never auto-publishes). Writes one `catalog_import_rows` row per processed row. Sets `status: IMPORTING → COMPLETED` (all rows processed) or `PARTIAL` (some rows failed during commit itself, e.g. a SKU collision introduced by a concurrent request after validation) — never silently drops a row.

**Given/When/Then:**
```
Given a 1000-row file where validation already rejected 30 rows
When POST /v1/seller/catalog/imports/{id}/commit is called after status reaches READY
Then the 970 valid rows each produce exactly one catalog_import_rows entry, status
     becomes COMPLETED, and re-calling commit with the same Idempotency-Key returns
     the same cached 200 response without creating a second batch of offers

Given the identical file (same bytes) is uploaded and confirmed twice by the same seller
When the second confirm's VALIDATING step computes the same content_hash as an existing
     non-FAILED job
Then the second job is marked COMPLETED with duplicate_of_job_id set, no rows are
     parsed, and no new seller_offers rows are created by it
```

**Prisma models:** `CatalogImportJob`, `CatalogImportRow`, `CatalogImportError` (owned by `catalog` module, per its own additive migration) — writes to `SellerOffer`/`Product`/`ProductVariant` go through each owning module's exported service, same boundary rule as everywhere else in this document.

---

## G2 file structure (frozen — every backend-dev agent creates files here, not an improvised equivalent)

```
apps/api/src/modules/
├── catalog/
│   ├── categories/
│   │   ├── categories.controller.ts
│   │   ├── categories.service.ts
│   │   ├── categories.mapper.ts
│   │   └── dto/{create-category.dto.ts, update-category.dto.ts}
│   ├── category-attributes/
│   │   ├── category-attributes.controller.ts
│   │   ├── category-attributes.service.ts
│   │   ├── category-attributes.mapper.ts
│   │   └── dto/{create-category-attribute.dto.ts, update-category-attribute.dto.ts}
│   ├── brands/
│   │   ├── brands.controller.ts
│   │   ├── brands.service.ts
│   │   └── dto/create-brand.dto.ts
│   ├── products/
│   │   ├── products.controller.ts
│   │   ├── products.service.ts     # exported as ProductsService for cross-module DI
│   │   ├── products.mapper.ts
│   │   └── dto/{create-product.dto.ts, update-product.dto.ts}
│   ├── variants/
│   │   ├── variants.controller.ts
│   │   ├── variants.service.ts     # exported as VariantsService — findPublishedOrThrow()
│   │   │                            # is the method offers/imports call via DI
│   │   ├── variants.mapper.ts
│   │   ├── options-hash.ts         # pure: canonicalize + sha256 the options JSON
│   │   └── dto/{create-variant.dto.ts, update-variant.dto.ts}
│   ├── media/
│   │   ├── media.controller.ts
│   │   ├── media.service.ts
│   │   └── dto/create-media.dto.ts
│   ├── identifiers/
│   │   ├── identifiers.controller.ts
│   │   ├── identifiers.service.ts  # exported as IdentifiersService — findByTypeValue()
│   │   │                            # is the method imports calls via DI
│   │   ├── gtin-checksum.ts        # pure GS1 mod-10 validator
│   │   └── dto/create-identifier.dto.ts
│   ├── merge-cases/
│   │   ├── merge-cases.controller.ts
│   │   ├── merge-cases.service.ts
│   │   └── dto/decision-reason.dto.ts
│   ├── moderation/
│   │   ├── catalog-moderation.controller.ts  # products/variants/media decision endpoints
│   │   ├── catalog-moderation.service.ts
│   │   └── dto/decision-reason.dto.ts
│   ├── imports/
│   │   ├── imports.controller.ts
│   │   ├── imports.service.ts
│   │   ├── import-row-processor.ts  # BullMQ job handler, confirm+commit background work
│   │   └── dto/create-import.dto.ts
│   └── catalog.module.ts            # exports ProductsService, VariantsService, IdentifiersService
├── offers/
│   ├── seller-offers.controller.ts
│   ├── seller-offers.service.ts     # exported as OffersService —
│   │                                  # repointVariantOwnership() is the method merge-cases calls via DI
│   ├── public-offers.controller.ts  # GET /v1/catalog/variants/{id}/offers — lives here, not in catalog/
│   ├── offers.mapper.ts
│   ├── price-history/
│   │   └── price-history.service.ts # write-path only in G2, no controller (see "Out of scope")
│   ├── moderation/
│   │   ├── offer-moderation.controller.ts
│   │   ├── offer-moderation.service.ts
│   │   └── dto/decision-reason.dto.ts
│   ├── dto/{create-offer.dto.ts, update-offer.dto.ts}
│   └── offers.module.ts             # exports OffersService; imports CatalogModule for VariantsService
└── pricing/
    └── pricing.module.ts            # untouched, still an empty ADR-001 stub — not G2 scope
```

Each `dto/decision-reason.dto.ts` copy (merge-cases, catalog-moderation, offer-moderation) is a deliberate, identical duplicate — not a shared import across module boundaries — consistent with every module in this codebase owning its own DTOs outright; the duplication is three ~10-line files, not a maintenance burden worth violating module independence for.

---

## Inconsistencies resolved (real contradictions found while reading the 8 tickets, not open questions)

1. **Permission-code format: `T-G2-1`'s proposed `catalog:category:manage` and `catalog:merge:approve` are 3-segment strings, but `PermissionGuard` (`apps/api/src/common/guards/permission.guard.ts`) does `requiredCode.split(':')` into exactly `[resource, action]` — a 3-segment code silently drops its third segment and checks the wrong `(resource, action)` tuple against `admin_permissions`, a real bug if implemented as `T-G2-1`'s literal text names it.** `T-G2-1`'s own text is **superseded** by this contract's permission-code table above: `catalog:category:manage` → `category:manage`; `catalog:merge:approve` → `merge_case:approve`; `catalog:moderate` and `offer:moderate` are kept but the latter is renamed `offers:moderate` (aligning the resource name with the `offers` module/table naming rather than the singular `offer`, which is otherwise used nowhere else in this codebase's permission or table names). Backend-dev implements `T-G2-1`'s seed data using these four exact codes, not the ticket's literal strings.

2. **Offer SKU field name: `T-G2-1` names the DB column/index as `seller_offers(seller_id, sku)`, but `T-G2-5` cites TZ §31's literal request body as `{variant_id, seller_sku, price_minor, currency, fulfillment_mode}`.** Not a real conflict once resolved explicitly (same pattern as `legalName`↔`legal_name` elsewhere in this codebase): the Prisma/DB column stays named `sku` (per `T-G2-1`, which is describing the index), and the wire/DTO JSON field is `seller_sku` (per TZ §31, frozen above verbatim) — the mapper layer (`offers.mapper.ts`) is responsible for the rename, exactly like every other Prisma-camelCase-to-wire-snake_case mapping already in this codebase. Flagged so neither parallel-pair agent picks a different one of the two names for both the column and the wire field.

3. **`product_attribute_values` and `product_media` are named in `T-G2-1`'s table list but omitted from both of its own explicit "gets `updated_at`+`version`" and "append-only, no `version`" lists.** Resolved per the Prisma field reference above: both are mutable data (attribute values are edited before first submit; media's `moderation_status`/`position` change after creation) and therefore follow `T-G2-1`'s own stated general rule ("every mutable table gets `updated_at`+`version`"), not the append-only exception — this is applying the ticket's own rule to a gap in its own enumeration, not overriding it.

4. **No ticket states when a `moderation_cases` row is created, or whether merge cases get one too** — `T-G2-1` says the tables are "reusable by `T-G2-6` ... and `T-G2-7`," but `T-G2-6`'s own acceptance text only ever mentions writing to `moderation_decisions`, never to `moderation_cases`. Resolved: `moderation_cases` rows exist only for `T-G2-7`'s product/variant/media/offer queue (created on PENDING_REVIEW entry, resolved on decision); merge cases use `product_merge_cases.status` as their own queue and never get a mirrored `moderation_cases` row, consistent with `T-G2-6`'s text never mentioning one and avoiding a redundant second status field for the same fact.

5. **`T-G2-7`'s "exact module home ... left to backend-dev's own design pass" is resolved, not left open**, since this document's whole purpose is to prevent the `T-G2-6`/`T-G2-7` parallel pair from each guessing a different split: product/variant/media moderation → `catalog/moderation/`; offer moderation → `offers/moderation/` (see file structure above).

No other field-name, type, or route-shape contradiction was found between any two of the 8 tickets.

---

## Out of scope (elaborating `SPEC.md`'s/the ticket set's own boundaries — flag what almost got designed in)

- **No edit/delete path for a wrongly-entered `product_identifiers` row.** The table is append-only by `T-G2-1`'s own explicit decision; a typo'd GTIN has no correction endpoint in G2. Almost got designed in (a `DELETE`/soft-void endpoint would be the obvious fix) but no ticket tests or requests it — flagged for a future ticket, not built here.
- **No `GET` endpoint for `offer_price_history` in G2.** The table and its `(offer_id, changed_at)` index exist specifically to anticipate EXT-002's 7/30/90/365-day chart queries (R1, gated on G6 per `docs/traceability.md`), but EXT-002 itself is not in this ticket set — only the write-path (`T-G2-5`) is in scope. Building a read endpoint now would be scope creep ahead of the feature that needs it.
- **No live MXIK/IKPU register validation.** Per `docs/open-questions.md` #32 — `classification_version` is stored as entered, never verified. Do not add a validation call against any external service in G2.
- **No video in `product_media`.** `T-G2-3`'s own text says "images JPEG/PNG/WebP with moderation" — the mime-type allowlist above is images only; TZ §07's blueprint mentions "images/video" in passing but no ticket's acceptance criteria exercises video upload/moderation. Flagged, not built.
- **No admin endpoint to view non-public (DRAFT/PENDING_REVIEW/etc.) product identifiers.** Only the moderation-queue (`T-G2-7`) and the product/variant admin GETs (which don't currently embed identifiers in their response shape above) exist; a dedicated admin identifiers-by-status view was considered and dropped as untested scope.
- **No OpenSearch.** Explicit `T-G2-1` decision, carried through every endpoint above — every list/browse query here runs against Postgres behind the cursor-pagination convention, never a search index.
- **No seller-facing "my product" authorship.** Confirmed throughout: sellers only ever create `seller_offers` against existing `PUBLISHED` variants (or, via `T-G2-8`, trigger creation of a `DRAFT` product that still must clear `T-G2-7`'s moderation) — never direct `products`/`product_variants` CRUD, which stays `category:manage`-gated admin-only.
- **No reactivate-after-REJECTED path for offers or products.** `REJECTED` is treated as terminal in this contract (no ticket tests resurrecting a rejected offer/product); a seller/admin wanting to try again creates a new row. If this is wrong, it is a PM-level scope question, not a gap to silently patch here.
