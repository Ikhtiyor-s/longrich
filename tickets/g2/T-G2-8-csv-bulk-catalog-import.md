# T-G2-8 — CSV/XLSX bulk catalog import (built to EXT-005's detailed spec)

**Requirement refs:** TZ §07 (blueprint `CAT-011` "CSV import" = canonical `CAT-008`), extensions doc EXT-005 (full state machine `UPLOADED→VALIDATING→READY→IMPORTING→COMPLETED→PARTIAL→FAILED`, per-seller SKU dedup, global product matching, background jobs, templates, admin file/rate limits) — per `docs/traceability.md`'s "Conflicts / overlaps" reconciliation #2, EXT-005 is treated as the authoritative detailed spec for what `CAT-008` should be built as, so this ticket builds directly to that state machine rather than a shallow version redone later for R1. §31 (`POST /v1/seller/catalog/imports`). Requirement ID: `CAT-008`. Milestone: G2.

**Scope note:** large enough to warrant its own ticket, same judgment-call precedent as G1's `SEL-006`/`SEL-007` split. Sequenced last in G2 and safe to slip if time-constrained — no other G2 ticket depends on it.

**Forward reference (DES, non-authoritative):** DES-014's seller portal "bulk import wizard" needs per-row error reporting and a preview/commit step — this ticket's `catalog_import_rows`/`catalog_import_errors` shape carries both already.

**Migration:** NEW — the one ticket in G2 besides `T-G2-1` that adds its own migration, because `catalog_import_jobs`/`catalog_import_rows`/`catalog_import_templates`/`catalog_import_errors` (EXT-005's own proposed tables) aren't in TZ §07's literal M03 table list and are large/isolated enough not to force into the shared G2 migration.

## Goal
Let a seller upload a CSV/XLSX file that either matches existing global products/variants (creating only offers) or proposes new `DRAFT` products (routed through `T-G2-7`'s moderation queue, never auto-published), with per-row validation, SKU dedup, and a commit step idempotent on repeat upload of the same file.

## Files likely touched
- `apps/api/src/modules/catalog/imports/`
- `prisma/schema.prisma` (additive models only)
- `prisma/migrations/000X_catalog_imports/migration.sql`

## How we'll know it's done
- A 1000-row file with 30 invalid rows: the 970 valid rows commit, the 30 are exported as row-level errors — "partial imports auditable and idempotent" (EXT-005 acceptance) proven.
- Duplicate upload of the identical file does not create duplicate offers (dedup on a content hash or equivalent, scoped per-seller).
- A row that matches an existing variant (via `T-G2-4`'s identifier lookup) creates only a `seller_offers` row; a row with no match creates a new `DRAFT` product (`T-G2-3` shape) that still must pass `T-G2-7`'s moderation before `ACTIVE`/`PUBLISHED` — "adding seller offer doesn't clone global product" holds even through bulk import.
- Import jobs are processed as background jobs (BullMQ, per ADR-001's existing outbox/worker infra — no second job-queue mechanism invented), not inline in the HTTP request.
- Non-member of the seller gets `403`; a seller `OPERATOR` role (per TZ §02 "pick/dispatch limited") cannot trigger an import — `OWNER`/`MANAGER` only.

## Owner role
`backend-dev`

## Depends on
T-G2-3, T-G2-4, T-G2-5
