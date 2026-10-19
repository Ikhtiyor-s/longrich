# T-G2-2 — Category taxonomy + mandatory category attributes

**Requirement refs:** TZ §07 (`CAT-001` nested taxonomy, canonical numbering; blueprint's own `CAT-002` "mandatory category attributes" folds into this ticket's scope — no standalone canonical ID exists for it, see `docs/traceability.md`'s G2 ticket mapping note), §28 (category attributes define per-category required/enum/numeric-range/unit/localization), §07 restricted-category certification flag (`docs/open-questions.md` #7). Requirement ID: `CAT-001`. Milestone: G2.

**Migration:** None — uses `T-G2-1`'s tables.

## Goal
Admin-managed nested category tree with a per-category attribute schema (required/enum/numeric/unit/localized) and a generic restricted-category certification flag, readable without auth and write-gated to a catalog-admin permission.

## Files likely touched
- `apps/api/src/modules/catalog/categories/` — controller, service, DTOs
- `apps/api/src/modules/catalog/category-attributes/` — controller, service, DTOs

## How we'll know it's done
- `GET /v1/catalog/categories` returns the nested tree (`parent_id`-based), cursor-paginated per TZ §04, public/no-auth per TZ §05 `WEB-003`'s backend dependency.
- `POST`/`PATCH` category (permission `catalog:category:manage`, seeded `SUPER_ADMIN`-only per `T-G2-1`) rejects a duplicate `slug` and rejects a `parent_id` that would create a cycle.
- `category_attributes` CRUD (same permission) validates its own `type`+`validation` shape (enum/numeric-range/unit/localization) at definition time — enforcement against a real variant's attribute values happens in `T-G2-3`; this ticket proves only that the rule definition itself is well-formed before it can be attached to a category.
- The restricted/certification-required flag is readable on the category response and settable only via this permission — no category ships pre-flagged as restricted/banned by guesswork (per `docs/open-questions.md` #7's interim).
- `version` is checked, not just present, on every category/category_attribute `PATCH` — 409 on stale version, explicit regression guard against the G1 QA TOCTOU finding.
- Unauthorized write attempt returns `403 FORBIDDEN`, never a silent 200.

## Owner role
`backend-dev`

## Depends on
T-G2-1
