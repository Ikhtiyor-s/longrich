# Longrich Marketplace — Requirement Traceability Matrix

Source of truth for scope: `docs/source/longrich-tz-master-blueprint.txt` (authoritative on conflict).
Cross-check / decomposition: `docs/source/prd-spreadsheet/*.csv` (same author, same TZ, pre-structured).
Extension track source (added 2026-10-18): `docs/source/longrich-tz-extensions-v2.4.txt` — "NEW FEATURES: COMPLETE FUNCTIONAL TZ v2.4", EXT-001..022, R1–R4, approved 2026-10-18. That document states explicitly it is an **extension to the 36-section Master TZ**, and that the Master TZ "remains source of truth" — the extension doc does not override the authority rule above, it adds 22 new requirement IDs on top of it. See "Extension track" section below.
Design track source (added 2026-10-18): `docs/source/longrich-design-system-v1.1.txt` — "DESIGN SYSTEM & FULL UX/UI SPECIFICATION v1.1 ADDENDUM: MASTER BLUEPRINTNING MAJBURIY DIZAYN QISMI", DES-001..021 + DES-AC-001..020, approved direction 2026-10-18. Explicitly states it is additive to the 01–36 master blueprint and the R1–R4/EXT extensions and does **not** change any business rule, purchase flow, payment, WMS, review/PVZ/repricing/B2B-quote timing, role or legal blocker already fixed by those documents. It is UI/UX-only: design tokens, breakpoints, buyer/seller/admin/WMS/Flutter information architecture, a shared component library, and DES-AC acceptance tests. Per the milestone legend below, buyer/seller/admin/warehouse web UI is G7 scope (Flutter is G8) — this document is the frozen design reference those milestones implement against once their backend/data prerequisites (G2–G6) land; it does not pull UI work earlier than the milestone plan already has it. During G2 ticket-writing (2026-10-18), the catalog/offers-relevant DES IDs (DES-004, DES-006, DES-007, DES-014, DES-015) were read and captured as non-authoritative, API-shape-awareness forward references inside the relevant `tickets/g2/*.md` files — no G2 ticket's Owner role is anything but `backend-dev`, and no UI work was pulled forward. A deliberately narrow slice of buyer-facing UI *is* ticketed starting 2026-10-20, scoped to only the routes whose backend already exists — see the new "G7 buyer-catalog-slice ticket mapping" note under the Buyer Web table below for the exact boundary.

This document is the long-lived tracking artifact required by TZ §36 ("create docs/traceability.md with requirement IDs, implementation status and test refs"). Update the **Status** column as work lands; do not mark a requirement "Done" without code + migration + tests + UI (where applicable) passing, per TZ §04 Definition of Done and §25/§36 Claude execution rules.

## Known conflict between the two sources (read before using this table)

The requirement IDs (`WEB-001`, `SEL-003`, `CAT-005`, `INV-004`, `ADM-005`, etc.) are **not consistently mapped to the same capability** between the two source documents:

- **Different counts per module.** Example: the blueprint prose (TZ §05) lists 12 buyer-web requirements `WEB-001..012` (signup/OTP, home CMS banner, category tree, search, variant/offer comparison, saved cart/wishlist, geo/delivery address, checkout, order timeline, return tickets, accessibility, SEO pages). The spreadsheet (`01_Requirements.csv`) lists only 8, `WEB-001..008`. Same drift exists for `CAT` (blueprint TZ §07 lists 12, `CAT-001..012`; spreadsheet lists 10) and `ADM` (blueprint TZ §12 lists 10, `ADM-001..010`; spreadsheet lists 9).
- **Same ID code, different capability.** Example: spreadsheet `SEL-003` = "Seller approval" (moderator approval/reject reason) but blueprint TZ §06 `SEL-003` = "bank info verification". Spreadsheet `CAT-002` = "Global product" but blueprint TZ §07 `CAT-002` = "mandatory category attributes". This shift (by one or more positions) recurs in `SEL`, `CAT`, `INV`, `ADM`, and partially `FIN`.
- **The orchestrator brief for this task cited "94 requirement IDs" in the spreadsheet; the actual count in `01_Requirements.csv` is 110** (summed below). Treat 110 as the current fact.

Decision made for this matrix: the **spreadsheet's ID → capability mapping is used as the canonical key** below, because it is the one scheme that is internally consistent across the spreadsheet's own `03_Acceptance_Tests.csv` (AC-IDs), `04_Database_Schema.csv`, `05_API_Contracts.csv`, and `11_Event_Catalog.csv`. Re-deriving IDs from the blueprint's more granular prose numbering would orphan all of those existing cross-references. This is a pragmatic tracking choice, not a business-rule override — the blueprint prose remains authoritative for scope and behavior per the project's own source-priority rule, and the capabilities it describes but the spreadsheet dropped (e.g., blueprint `WEB` home-CMS-banner, SEO pages as distinct items; `CAT-011` CSV import, `CAT-012` moderation as distinct items; `ADM-004` suspend/reinstate as distinct item) are **not lost** — they are folded into the nearest spreadsheet ID's scope (e.g., CMS banner → `OPS-008` CMS; CSV import → `CAT-008` Bulk import; suspend/reinstate → `ADM-002` Seller management) and should be checked off explicitly when that ticket is implemented.

**Action recommended before G1 starts:** a short reconciliation ADR that pins the final ID scheme (likely: adopt spreadsheet IDs as-is, re-point blueprint section numbers in doc comments). Does not block G0. **Status as of G1 ticket-writing (2026-10-18): this ADR still has not been written.** The G1 ticket set below proceeds pragmatically on the existing spreadsheet-canonical mapping rather than blocking on it, per the same "flag, don't block" policy already used throughout this file — two more fold decisions made in that pass are recorded in the new "G1 ticket mapping" note under the Seller table below. **Status as of G2 ticket-writing (2026-10-18): still not written.** The G2 ticket set proceeds the same way — five more fold decisions made in that pass are recorded in the new "G2 ticket mapping" note under the Catalog table below.

No other factual contradictions were found between the two sources (reservation TTL = 15 min, commission bps convention, UZS minor-unit handling, and the longrich.uzbekistan.uz subdomain caveat all agree).

**Note (2026-10-18):** the extensions doc (EXT-001..022, see below) reuses the `CAT-NNN` style of numbering for its own, unrelated purposes in places and this created a second, separate instance of the same kind of ID-ambiguity risk described above — see "Conflicts / overlaps between the extensions doc and the original TZ" near the bottom of this file. The same policy applies: flag and reconcile explicitly, don't silently treat same-capability specs at different detail levels as unrelated.

## G0 status: DONE (2026-10-17/18)

All 6 G0 tickets (`tickets/g0/T-G0-1` through `T-G0-6`) implemented and tested, plus one post-landing CI fix (e2e job had no DB/Redis service containers wired, so e2e never actually ran in CI despite looking green locally — fixed). An independent QA pass then found 2 blockers (OTP attempt-lockout bypassable via concurrent requests; `JWT_SECRET`/`OTP_HMAC_SECRET` silently falling back to source-committed dev defaults with no production guard) and 5 majors (missing session/JWT subject cross-check, an unredacted OTP field name, per-controller-not-global envelope/request-id wiring, a refresh-token-reuse race window, missing `updated_at` on two mutable tables) — all fixed and re-verified (unit 85/85, e2e 34/34, migration tests 7/7, lint/typecheck/build clean). Not yet done: real secret-manager wiring for anything beyond dev/CI (TZ §20 — production secrets are explicitly out of scope until deployment), and a `version`-column optimistic-concurrency standard beyond the one table (`otp_challenges`, via its attempt-count CAS) that needed it for G0. Nothing has been committed to git yet — repo is initialized but all work is currently uncommitted, pending review.

## G1 status: DONE (2026-10-18)

All 8 tickets (`T-G1-1` through `T-G1-8`) implemented and tested — seller schema/migrations (0004-0007), application intake (create/edit/contract-acceptance/submit/resubmit), KYB document upload (signed URLs, swappable malware-scan adapter), staff RBAC/ownership (first real seller_id-scoped `OwnershipGuard` wiring), moderation/suspension lifecycle, profile/shop settings, ops dashboard shell (explicit G2/G3/G4/G6 placeholders), finance/bank-account surface (masked, review-gated). `SEL-001..009` and `ADM-002` covered — see the "G1 ticket mapping" note under the Seller table below for exact requirement-to-ticket mapping.

An independent QA pass found 4 majors (idempotency-key scope strings exceeding the DB column's 64-char cap on 3 endpoints; `version` optimistic-concurrency columns present but never checked — TOCTOU risk on concurrent moderation actions; `NEEDS_CHANGES` was a dead end with no resubmission path; `SellerBankAccount.encryptedReference` stored plaintext under a misleading name) and 2 minors (no zero-OWNER safeguard; `UNDER_REVIEW` effectively unreachable, disclosed/accepted) — all majors fixed and re-verified, one minor fixed (zero-OWNER guard), one minor explicitly left as disclosed behavior. Final state: 178 unit + 171 e2e + 20 migration tests, all passing, zero regressions. New migration `0007` renamed the plaintext bank-reference column to `raw_reference` to stop misleading future readers; real encryption-at-rest for that field remains an open gap (`docs/open-questions.md` #31) that must be closed before any real seller bank data is ever stored. Also fixed during this milestone: e2e test suite was flaky under Jest's default parallel workers (confirmed independently by 2 different tickets) — `apps/api/test/jest-e2e.json` now pins `maxWorkers: 1`, so `pnpm test:e2e` is reliable without needing `--runInBand` manually.

Nothing has been committed to git yet — all G0+G1 work is currently uncommitted, pending review.

## G2 status: DONE (2026-10-19)

All 8 tickets (`tickets/g2/T-G2-1` through `T-G2-8`) implemented and tested, covering canonical `CAT-001..010` plus `ADM-003` (folded, see the "G2 ticket mapping" note under the Catalog table below). An independent QA pass then found 1 blocker (`GET /v1/catalog/products/{id}` leaked DRAFT/PENDING_REVIEW/REJECTED/SUSPENDED/ARCHIVED product detail — including an admin's internal moderation-reject reason — to any unauthenticated caller with the id, plus unmoderated PENDING/REJECTED media leaking even on PUBLISHED products) and 4 majors (`T-G2-6` merge-approval silently dropped a seller-offer SKU-collision during variant repoint with no record anywhere; `T-G2-8` import commit silently absorbed a GTIN/MXIK conflict instead of surfacing it in the row-level error export; `media:create`'s idempotency-key scope was a non-templated literal string risking a cross-product response collision; missing test coverage for all three of the above) — all fixed and re-verified. A separate infra bug was then caught by a full e2e run on top of the QA fixes (not something the QA pass itself could see, since it's read-only code review, not an execution environment issue): `docker-compose.dev.yml`'s `worker` service was missing the `MINIO_ENDPOINT`/`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/`MINIO_BUCKET` env vars entirely (only `api` had them) — harmless until `T-G2-8`'s `CatalogImportWorker` became the first worker-side code to actually read object content back (`StorageService.getObjectBuffer`), at which point the missing `MINIO_ENDPOINT` silently fell back to `storage.config.ts`'s `http://localhost:9000` default, which does not resolve to anything inside the worker container — `ECONNREFUSED` on every real CSV import commit, surfacing in e2e as 3 `pollUntil timed out` failures (the job never left `IMPORTING`). Fixed by adding the same MinIO env block the `api` service already had to `worker`'s. Final state after both fix rounds: **401 unit + 319 e2e (17/17 suites) + migration tests, all passing, zero regressions.** Three minors from the QA pass were resolved as: naive regex-based description sanitization left as-is (data-corruption risk only, not XSS, self-documented); a small TOCTOU window on duplicate moderation-case creation during concurrent media `confirm` calls (duplicate queue entries only, not wrong state — left as-is, no migration-requiring fix attempted); the identifiers idempotent-repost-to-same-variant behavior explicitly signed off as intentional.

Decomposition: `T-G2-1` is the single schema/migration ticket (categories, category_attributes, brands, products, product_variants, product_identifiers, product_attribute_values, seller_offers, offer_price_history, product_media, product_merge_cases, plus the first real `moderation_cases`/`moderation_decisions` tables — listed in TZ §12 but never built in G0); `T-G2-2` through `T-G2-7` are one ticket per cohesive capability group (category taxonomy+attributes, product/variant/brand/media lifecycle, barcode/MXIK identifiers, seller offers+price history, GTIN duplicate/merge review, catalog/offer moderation queue); `T-G2-8` (bulk CSV/XLSX import) is split out as its own ticket on the same "large enough to warrant its own ticket" judgment call G1 used for `SEL-006`/`SEL-007` — it is sequenced last and nothing else in G2 depends on it, so it is safe to slip without blocking the rest of the milestone.

Explicit architecture decision stated in `T-G2-1` and carried through every G2 ticket: **OpenSearch is NOT required for G2.** All catalog/offer list and browse endpoints this milestone builds query Postgres directly behind cursor pagination and composite indexes, consistent with ADR-001's "resource permitting" OpenSearch profile — full-text search relevance tuning stays out of scope (buyer-facing `/v1/search`, WEB-004, is G7 UI + its own backend decision, not re-derived here). Also explicitly out of scope per the task brief: the actual buyer-facing web UI consuming these APIs (G7). Every G2 ticket's Owner role is `backend-dev` only — the design-system (DES) cross-references captured in ticket text are forward-looking API-shape notes for whoever eventually writes the G7 UI tickets, not a signal that any UI work landed early.

One new open question was raised and logged (`docs/open-questions.md` #32): the authoritative source for Uzbekistan's MXIK/IKPU tax classification code list is not named anywhere in the TZ. `T-G2-4` stores a versioned, unverified MXIK code rather than guessing at or building a live validation integration against an unconfirmed register.

Nothing has been committed to git yet — all G0+G1+G2 work is currently uncommitted, pending review.

## Milestone legend (TZ §36)

| Code | Milestone |
|---|---|
| G0 | Repo scaffold, CI, auth (SMS OTP), RBAC skeleton, infra (Docker Compose dev), initial Prisma schema/migrations for identity+RBAC, observability/tracing scaffold |
| G1 | Seller onboarding / KYB |
| G2 | Global catalog / offers |
| G3 | Inventory + WMS receiving |
| G4 | Cart / checkout / orders with mock PSP |
| G5 | Sandbox Click/Payme, ledger, refund |
| G6 | Shipping + WMS picking/packing |
| G7 | Full web UIs (buyer, seller, admin, warehouse) |
| G8 | Flutter Android/iOS apps |
| G9 | Hardening, observability, pilot |

Milestone assignment rule used below: each requirement is pinned to the milestone where TZ §36's roadmap first delivers its **backend/data capability**. Pure UI-surface requirements for buyer/seller/admin/warehouse web (whose backend already lives in an earlier milestone) are pinned to **G7**, since TZ §36 explicitly defers "full web UIs" as its own milestone; Flutter-specific requirements are pinned to **G8**. This is a PM interpretation where the TZ is silent on a requirement's exact milestone — flagged here for visibility, not hidden.

### Release track R1–R4 is layered ON TOP of G0–G9, not parallel/independent (added 2026-10-18)

The extensions doc is explicit on this point ("Release gates require both existing Master TZ G0–G9 dependencies and extension test evidence") and this matrix treats it as binding, not as a suggestion. Concretely: **R1 cannot start until every one of its 6 features' prerequisite G-milestones is done; a release's earliest-ready point is when the LAST of its features' prerequisites lands**, exactly as instructed. The full per-feature derivation is in the "Extension track: R1–R4" section below; the headline result:

| Release | Features | Union of G-milestone prerequisites | Earliest-ready gate | Gate driven by |
|---|---|---|---|---|
| R1 | EXT-001..006 (6) | G1, G2, G4, G6 | **G6** | EXT-004 (reviews need a delivered shipment / `delivered_at` proof — G6). The other 5 R1 features only need G1+G2 and could start earlier if EXT-004 is sequenced last within R1. |
| R2 | EXT-007..013 (7) | G1, G2, G3, G4, G5, G6 | **G6** | EXT-010/EXT-011/EXT-012 (PVZ, QR handover, return QC all sit on the shipment/return-inbound data model — G6). |
| R3 | EXT-014..019 (6) | G2, G3, G4, G5, G6 (+ G7 soft, one feature) | **G6** | EXT-017 referral (delivered-purchase trigger — G6). |
| R4 | EXT-020..022 (3) | G1, G2, G3, G4, G5, G6 | **G6** | EXT-022 seller mobile app (surfaces the seller order queue, `SEL-007`, which is G6). |

**Stated working assumption (flagged, not silently assumed):** this matrix treats G0→G9 as cumulative/sequential — i.e. "needs G4" is read as "needs G0–G4 done," because the roadmap's own module list is built that way (checkout/G4 already presumes inventory reservation/G3; ledger/G5 already presumes orders/G4; shipping/G6 already presumes orders/G4). If the team ever parallelizes milestones out of this order, each feature's *true* floor is only the specific milestone(s) listed for it below, not "that milestone and everything numerically before it."

**Notable finding:** under that assumption, all four releases' hard backend/data prerequisites top out at **G6** — none of the 22 EXT features has a hard dependency on G7 (full web UI), G8 (Flutter), or G9 (hardening), because those are UI-shell/mobile-shell/ops milestones, not new domain capability. G7 shows up only as a **soft "UI route must exist to attach to"** dependency for 5 features (EXT-001, EXT-002, EXT-003, EXT-004, EXT-014 — they anchor to a buyer product-detail page, order-detail page, or SEO page that is itself G7 scope), not as a backend blocker. This does **not** mean R1–R4 are "free" once G6 lands — each EXT feature still needs its own new tables/APIs/UI, which is additive work layered on top, not already covered by any G-milestone ticket.

## Matrix

### 01 Buyer Web

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| WEB-001 | OTP authentication | P0 | G0 | Done — T-G0-4: `POST /v1/auth/otp/{request,verify}`, `/v1/auth/token/refresh`, `/v1/auth/logout`, `GET/PATCH /v1/me`. Hashed OTP (HMAC, constant-time compare), E.164 normalization, anti-enumeration, per-phone/device/IP rate limits, atomic attempt-lockout (race condition found+fixed post-QA), session+refresh-token rotation with reuse detection (race condition found+fixed post-QA). Backend/API only — buyer web UI itself is G7. |
| WEB-002 | Catalog navigation | P0 | G7 | Partially ticketed — `T-G7C-3`/`T-G7C-4` (`tickets/g7-buyer-web-catalog/`) deliver home + category-browse UI against G2's existing catalog data only; search, faceted filters, personalization, and brand/price/seller/rating/region facets remain **Not started** — no backend exists for them yet (see that ticket set's own scope notes). |
| WEB-003 | Product detail | P0 | G7 | Partially ticketed — `T-G7C-5` (`tickets/g7-buyer-web-catalog/`) delivers the product-detail UI against G2's existing product/variant/offer data only (Tavsif/Xususiyatlar/Do'konlar tabs, route `/product/[id]` pending `docs/open-questions.md` #33). Narx tarixi/Savol-javob/Sharhlar tabs remain **Not started**, pending EXT-002/003/004 backend. |
| WEB-004 | Cart and checkout UI | P0 | G7 | Not started — blocked on G4 (cart/checkout/orders backend does not exist yet); explicitly excluded from the `tickets/g7-buyer-web-catalog/` slice. |
| WEB-005 | Customer account | P0 | G7 | Not started — blocked on G4+ (account/order history needs orders backend); explicitly excluded from the `tickets/g7-buyer-web-catalog/` slice. |
| WEB-006 | Responsive accessibility | P0 | G7 | Partially ticketed — `T-G7C-6` (`tickets/g7-buyer-web-catalog/`) covers the WCAG 2.2 AA / responsive bar only for the three pages that slice builds (home, category browse, product detail); a full-site accessibility pass remains **Not started** until the rest of G7 is built. |
| WEB-007 | Localization | P1 | G7 | Not started |
| WEB-008 | Order tracking | P1 | G7 | Not started — blocked on G4+G6 (orders/shipment backend does not exist yet); explicitly excluded from the `tickets/g7-buyer-web-catalog/` slice. |

**G7 buyer-catalog-slice ticket mapping (added 2026-10-20, PM pass — buyer web UI, catalog/offers browsing only, NOT full G7):** tickets live in `tickets/g7-buyer-web-catalog/` (`T-G7C-1` through `T-G7C-6`) — a deliberately narrow slice of the full G7 milestone, not full G7 itself. Per this matrix's own milestone-assignment rule, full G7 (buyer+seller+admin+warehouse web) stays gated on G2–G6 backend being done; this slice is scoped to **only** the buyer routes whose backend already exists today (G2's catalog/offers API): home (`/`), category browse (`/catalog/[categorySlug]`), and product detail (`/product/[id]` — see `docs/open-questions.md` #33, no `slug` column exists yet so DES-004's literal `/product/[slug]` is deferred), plus a `@longrich/ui-kit` component-library buildout those three pages share, and a dedicated responsive/accessibility pass. Execution/dependency order: `T-G7C-1` (ui-kit nav-chrome: AppShell/Header/MobileNav/SearchCombobox/Breadcrumb) and `T-G7C-2` (ui-kit content primitives: ProductCard/CategoryTile/PriceBlock/Skeleton/EmptyState/ErrorPanel/OfferComparison) have no page dependencies and can run in parallel → `T-G7C-3`/`T-G7C-4`/`T-G7C-5` (home/category/product pages, each depending on both ui-kit tickets, otherwise independent of each other, can run in parallel) → `T-G7C-6` (responsive/accessibility pass, depends on all three pages). Styling approach frozen for this entire slice: **CSS Modules** — no new CSS-in-JS dependency, no Tailwind; see `T-G7C-1`'s own text for the full rationale. No store/seller-directory page (`/stores`, `/stores/[slug]`) is ticketed in this slice: confirmed by reading every controller in `apps/api/src/modules/sellers/` directly, every seller-profile read route is `JwtAuthGuard`-gated — no public seller/storefront endpoint exists yet — flagged as `docs/open-questions.md` #34, not built as a workaround. Cart/checkout/account/order-tracking UI (`WEB-004`/`005`/`008`) are **not** touched by this slice and remain explicitly blocked on their G3–G6 backend prerequisites exactly as this matrix already states — this slice does not pull any of that work forward.

### 02 Seller

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| SEL-001 | Seller application | P0 | G1 | Ticketed — `T-G1-2` (also folds blueprint §06's "contract acceptance/e-sign" sub-item, which has no separate ID in the canonical spreadsheet mapping; see G1 ticket mapping note below) |
| SEL-002 | Document validation | P0 | G1 | Ticketed — `T-G1-3` |
| SEL-003 | Seller approval | P0 | G1 | Ticketed — `T-G1-5` |
| SEL-004 | Store settings | P0 | G1 | Ticketed — `T-G1-6` |
| SEL-005 | Seller team RBAC | P0 | G1 | Ticketed — `T-G1-4` (first real `OwnershipGuard` wiring against a seller_id-scoped resource, per G0's `T-G0-5` design intent) |
| SEL-006 | Seller offer tools | P0 | G2 | Partially ticketed — `T-G1-7` built only the seller-side permission codes + dashboard-shell surface for this capability in G1; the actual catalog/offer data model and CRUD are now ticketed for G2 as `T-G2-5` (plus the shared catalog/variant tables `T-G2-1..T-G2-4` it depends on) — see the "G2 ticket mapping" note under the Catalog table below |
| SEL-007 | Seller order queue | P1 | G6 | Partially ticketed — `T-G1-7` (same dashboard-shell/permission-surface scope as SEL-006 above); real order-queue data remains pinned to G6 (needs Orders/G4 + fulfillment/G6) — milestone unchanged |
| SEL-008 | Seller finance views | P1 | G5 | Partially ticketed — `T-G1-8` builds the permission-gated surface + bank-account management/review (also folds blueprint §06's "bank info verification" sub-item, no separate canonical ID) now; the real ledger/statement data stays pinned to G5 — milestone unchanged |
| SEL-009 | Seller suspension | P1 | G1 | Ticketed — `T-G1-5` (also folds `ADM-002`, see below and Admin table) |

**G1 ticket mapping (added 2026-10-18, PM pass for the Seller Onboarding & Portal milestone):** tickets live in `tickets/g1/`. Execution/dependency order: `T-G1-1` (schema/migration, no behavior) → `T-G1-2` (SEL-001) → `T-G1-3` (SEL-002) → `T-G1-4` (SEL-005) → `T-G1-5` (SEL-003 + SEL-009 + `ADM-002`) → `T-G1-6` (SEL-004) → `T-G1-7` (SEL-006/007 surface only) → `T-G1-8` (SEL-008). Only `T-G1-1` adds a new Prisma migration; every other G1 ticket is pure business logic / RBAC wiring on top of it. Two ID-mapping decisions made in this pass, following the same fold policy already established above for blueprint-vs-spreadsheet drift: (1) blueprint §06's "contract acceptance/e-sign" item has no standalone ID in the canonical spreadsheet scheme — folded into `SEL-001`'s scope (submit is gated on contract acknowledgement per TZ §28, same transaction family as the application itself); (2) blueprint §06's "bank info verification" item likewise has no standalone canonical ID — folded into `SEL-008` (finance-adjacent, and `seller_bank_accounts` is a finance-proximate table). `SEL-006`/`SEL-007` deliberately do **not** get full G1 tickets — see `T-G1-7`'s own text for why building against non-existent G2/G3/G4/G6 tables was explicitly avoided.

### 03 Catalog

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| CAT-001 | Category taxonomy | P0 | G2 | Ticketed — `T-G2-2` (also folds blueprint's own "mandatory category attributes" item, which has no separate ID in the canonical spreadsheet mapping; see G2 ticket mapping note below) |
| CAT-002 | Global product | P0 | G2 | Ticketed — `T-G2-3` (also folds blueprint's own "brand" item, no separate canonical ID) |
| CAT-003 | Variants | P0 | G2 | Ticketed — `T-G2-3` |
| CAT-004 | Barcode MXIK | P0 | G2 | Ticketed — `T-G2-4` |
| CAT-005 | Offers | P0 | G2 | Ticketed — `T-G2-5` |
| CAT-006 | Duplicate resolution | P0 | G2 | Ticketed — `T-G2-6` |
| CAT-007 | Catalog moderation | P1 | G2 | Ticketed — `T-G2-7` (also folds `ADM-003`, see below and Admin table) |
| CAT-008 | Bulk import | P1 | G2 | Ticketed — `T-G2-8` (built directly to EXT-005's detailed state machine, per the extensions-conflicts reconciliation note #2 below — not a shallow version redone later for R1) |
| CAT-009 | Price history | P1 | G2 | Ticketed — `T-G2-5` (same ticket as CAT-005 Offers — one seller-offers price-change event writes one append-only history row, not two separate build tracks) |
| CAT-010 | Media | P1 | G2 | Ticketed — `T-G2-3` (same ticket as CAT-002/003 — product media shares the same lifecycle/moderation gate as the product/variant it belongs to) |

**G2 ticket mapping (added 2026-10-18, PM pass for the Global Catalog & Offers milestone):** tickets live in `tickets/g2/`. Execution/dependency order: `T-G2-1` (schema/migration, no behavior) → `T-G2-2` (CAT-001) → `T-G2-3` (CAT-002/003/010) → `T-G2-4` (CAT-004) and `T-G2-5` (CAT-005/009) in parallel, both only needing `T-G2-3` → `T-G2-6` (CAT-006, needs `T-G2-4`+`T-G2-5`) and `T-G2-7` (CAT-007 + `ADM-003`, needs `T-G2-3`+`T-G2-5`) in parallel → `T-G2-8` (CAT-008, needs `T-G2-3`/`T-G2-4`/`T-G2-5`, sequenced last, nothing else depends on it). Only `T-G2-1` adds a Prisma migration shared by the rest of the milestone; `T-G2-8` is the one exception, adding its own additive migration for EXT-005's import-specific tables, which aren't in TZ §07's literal M03 table list. Five ID-mapping decisions made in this pass, following the same fold policy already established for the blueprint-vs-spreadsheet drift (see G1's own mapping note above for precedent): (1) blueprint's "mandatory category attributes" item has no standalone canonical ID — folded into `CAT-001` (same table family, categories ↔ category_attributes); (2) blueprint's "brand" item likewise has no standalone canonical ID — folded into `CAT-002` (a `brand_id` column on `products`, not its own requirement); (3) `ADM-003` (Product moderation) has no catalog-specific canonical ID of its own — folded into `CAT-007`, same "ADM-00X folds into a sibling ticket" pattern G1 already used for `ADM-002`/`SEL-009`; (4) blueprint's single combined "seller offers/price history" item splits cleanly into canonical `CAT-005`+`CAT-009` but both are built in the same ticket (`T-G2-5`) since one mutation path produces both the offer row and its history row — not a fold, just a shared implementation; (5) `CAT-010` (Media) is folded into `T-G2-3` alongside the product/variant it belongs to, rather than getting a standalone ticket, since product media shares that same entity's moderation gate and lifecycle. Per `docs/traceability.md`'s own milestone-assignment rule, `SEL-006` (Seller offer tools, Seller table above) is the mirror-image cross-reference: its real data model is exactly `T-G2-5`.

### 04 Inventory

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| INV-001 | Warehouse stock | P0 | G3 | Not started |
| INV-002 | Atomic reserve | P0 | G3 | Not started |
| INV-003 | Reservation TTL | P0 | G3 | Not started |
| INV-004 | Reserve commit/release | P0 | G3 | Not started |
| INV-005 | Adjustments | P0 | G3 | Not started |
| INV-006 | Physical stock audit | P0 | G3 | Not started |
| INV-007 | Low stock | P1 | G3 | Not started |
| INV-008 | Warehouse transfer | P1 | G3 | Not started |

### 05 Orders

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| ORD-001 | Cart persistence | P0 | G4 | Not started |
| ORD-002 | Quote validation | P0 | G4 | Not started |
| ORD-003 | Master and suborders | P0 | G4 | Not started |
| ORD-004 | Payment intent | P0 | G4 | Not started |
| ORD-005 | Order transitions | P0 | G4 | Not started |
| ORD-006 | Cancellation | P0 | G4 | Not started |
| ORD-007 | Mixed fulfillment | P1 | G4 | Not started |
| ORD-008 | Idempotent checkout | P1 | G4 | Not started |

### 06 Finance

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| FIN-001 | Commission policies | P0 | G5 | Not started |
| FIN-002 | Commission snapshots | P0 | G5 | Not started |
| FIN-003 | Balanced ledger | P0 | G5 | Not started |
| FIN-004 | Seller balances | P0 | G5 | Not started |
| FIN-005 | Settlement | P0 | G5 | Not started |
| FIN-006 | Payout | P0 | G5 | Not started |
| FIN-007 | Refund accounting | P1 | G5 | Not started |
| FIN-008 | Statements | P1 | G5 | Not started |

### 07 Logistics

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| LOG-001 | Delivery zones | P0 | G6 | Not started |
| LOG-002 | Delivery tariffs | P0 | G6 | Not started |
| LOG-003 | Delivery quote | P0 | G6 | Not started |
| LOG-004 | Shipment creation | P0 | G6 | Not started |
| LOG-005 | Tracking events | P0 | G6 | Not started |
| LOG-006 | Dispatch | P0 | G6 | Not started |
| LOG-007 | Delivery proof | P1 | G6 | Not started |
| LOG-008 | Failure return | P1 | G6 | Not started |

### 08 Admin

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| ADM-001 | Admin dashboard | P0 | G7 | Not started |
| ADM-002 | Seller management | P0 | G1 | Ticketed — `T-G1-5` (folds seller suspend/reinstate, same ticket as `SEL-009`; see "02 Seller" table and its G1 ticket mapping note above) |
| ADM-003 | Product moderation | P0 | G2 | Ticketed — `T-G2-7` (folds into the Catalog & offer moderation queue ticket, same ticket as canonical `CAT-007`; see "03 Catalog" table and its G2 ticket mapping note above) |
| ADM-004 | Order oversight | P0 | G4 | Not started |
| ADM-005 | Finance approvals | P0 | G5 | Not started |
| ADM-006 | Warehouse monitoring | P0 | G6 | Not started |
| ADM-007 | Admin RBAC | P1 | G0 | Mechanism landed (T-G0-5): schema+migration from T-G0-3 (`admin_roles`/`admin_permissions`/`admin_role_permissions`/`admin_members`, seeded roles/permissions); `PermissionGuard`/`@RequirePermission` (`apps/api/src/common/guards/permission.guard.ts`) + `OwnershipGuard`/`@RequireOwnership` (resource-ownership, proven only against a fake fixture — no seller/warehouse resource tables exist yet) + `AdminMfaService` TOTP scaffold (`apps/api/src/modules/identity/admin-mfa.service.ts`, not wired to any login flow — no admin UI exists yet). Proven end-to-end via real OTP login as the seeded SUPER_ADMIN (200) and SUPPORT_AGENT (403) against a throwaway `test:read` fixture route (`apps/api/test/rbac.e2e-spec.ts`). Full TZ §34 matrix (seller_id isolation, dual-control, etc.) stays "Not started" until G1+ resource tables exist — G1's `T-G1-4` is the first ticket to actually exercise it against a real seller_id-scoped resource. |
| ADM-008 | Audit log | P1 | G0 | In progress — schema+migration done (T-G0-3: `audit_logs`, DB-trigger append-only enforcement verified). T-G0-5's `PermissionGuard` is the first service code to write a real row (`action="authz.permission_denied"` on every 403), covered by `rbac.e2e-spec.ts`; broader audit coverage of other mutating actions lands with the modules that write them (T-G0-4+, now also G1's seller lifecycle/profile tickets and G2's catalog/offer moderation ticket). |
| ADM-009 | Feature flags | P1 | G9 | Not started |

### 09 Operations (Returns / Support / SEO / Notifications)

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| OPS-001 | Returns workflow | P0 | G5 | Not started |
| OPS-002 | Partial refund | P0 | G5 | Not started |
| OPS-003 | Dispute resolution | P0 | G5 | Not started |
| OPS-004 | Support ticket | P0 | G7 | Not started |
| OPS-005 | Support messages | P0 | G7 | Not started |
| OPS-006 | SEO product pages | P0 | G7 | Not started |
| OPS-007 | Sitemap robots | P1 | G7 | Not started |
| OPS-008 | CMS | P1 | G7 | Not started |
| OPS-009 | Notifications | P1 | G7 | Not started |
| OPS-010 | Notification idempotency | P1 | G9 | Not started |

### 10 Mobile (Flutter Android/iOS)

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| MOB-001 | Cross platform app | P0 | G8 | Not started |
| MOB-002 | Mobile OTP | P0 | G8 | Not started |
| MOB-003 | Catalog experience | P0 | G8 | Not started |
| MOB-004 | Checkout mobile | P0 | G8 | Not started |
| MOB-005 | Order status | P0 | G8 | Not started |
| MOB-006 | Push notifications | P0 | G8 | Not started |
| MOB-007 | Deep link | P1 | G8 | Not started |
| MOB-008 | Offline behavior | P1 | G8 | Not started |
| MOB-009 | App compatibility | P1 | G8 | Not started |
| MOB-010 | Accessibility | P1 | G8 | Not started |

### 11 Payments (Click / Payme)

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| PAY-001 | Payment intent | P0 | G5 | Not started |
| PAY-002 | Click adapter | P0 | G5 | Not started |
| PAY-003 | Payme adapter | P0 | G5 | Not started |
| PAY-004 | Callback verification | P0 | G5 | Not started |
| PAY-005 | Idempotent webhook | P0 | G5 | Not started |
| PAY-006 | Payment recovery | P0 | G5 | Not started |
| PAY-007 | Partial refunds | P1 | G5 | Not started |
| PAY-008 | Reconciliation | P1 | G5 | Not started |
| PAY-009 | Sandbox production | P1 | G5 | Not started |

### 12 Fulfillment (Own WMS)

| ID | Capability | Priority | Milestone | Status |
|---|---|---|---|---|
| FUL-001 | Fulfillment center | P0 | G3 | Not started |
| FUL-002 | Bin topology | P0 | G3 | Not started |
| FUL-003 | Inbound ASN | P0 | G3 | Not started |
| FUL-004 | Receiving | P0 | G3 | Not started |
| FUL-005 | Quality control | P0 | G3 | Not started |
| FUL-006 | Putaway | P0 | G3 | Not started |
| FUL-007 | Seller ownership | P1 | G3 | Not started |
| FUL-008 | Picking | P1 | G6 | Not started |
| FUL-009 | Packing | P1 | G6 | Not started |
| FUL-010 | Dispatch | P1 | G6 | Not started |
| FUL-011 | Stocktake | P1 | G6 | Not started |
| FUL-012 | Return inbound | P1 | G6 | Not started |
| FUL-013 | Batch serial tracking | P1 | G3 | Not started |

## Totals (core TZ)

110 requirement IDs across 12 modules (WEB 8, SEL 9, CAT 10, INV 8, ORD 8, FIN 8, LOG 8, ADM 9, OPS 10, MOB 10, PAY 9, FUL 13). G0 scope from this matrix: `WEB-001`, `ADM-007`, `ADM-008` (see "Known conflict" section above for why the count differs from the orchestrator's cited 94). G1 scope from this matrix: `SEL-001..005`, `SEL-009`, `ADM-002` (full), plus partial groundwork on `SEL-006`, `SEL-007`, `SEL-008` whose real backend/data capability stays pinned to G2/G5/G6 respectively. G2 scope from this matrix: `CAT-001..010` (full), `ADM-003` (full, folded into `CAT-007`'s ticket) — all ticketed, none implemented yet. G7 scope touched so far (2026-10-20): a narrow buyer-catalog-browsing slice of `WEB-002`/`WEB-003`/`WEB-006` only — see the "G7 buyer-catalog-slice ticket mapping" note under the Buyer Web table above; the rest of G7 (seller/admin/warehouse web, and the cart/checkout/account/order-tracking/search parts of buyer web) remains untouched.

See "Extension track" below for the 22 additional `EXT-NNN` IDs added 2026-10-18, and "Grand totals" at the very end of this file for the combined count.

---

## Extension track: R1–R4 (EXT-001..022, added 2026-10-18)

Source: `docs/source/longrich-tz-extensions-v2.4.txt`. All 22 IDs below are **Not started** — nothing from this doc is implemented; this is a planning-only addition to the backlog, not new tickets (tickets are deliberately not cut yet — see Open Questions / process note below). Priority is not separately tracked here because the source doc expresses priority purely via release (R1 = first, R4 = last); where the source was genuinely silent or ambiguous on a dependency, that is flagged inline rather than guessed, per the no-invention rule that governs this whole project.

### R1 (6 features)

| ID | Feature (uz) / gloss (en) | Depends on (G-milestone) | Status |
|---|---|---|---|
| EXT-001 | Mahsulotlarni solishtirish / Product comparison | G2 | Not started |
| EXT-002 | Narx tarixi va bildirishnomalar / Price history & alerts | G1, G2 (+ G7 soft: OPS-009 notification channel) | Not started |
| EXT-003 | Seller savol-javobi / Seller Q&A | G1, G2 (+ G7 soft: product-detail route) | Not started |
| EXT-004 | Foto/video sharhlar / Photo & video reviews | G1, G2, G4, G6 (+ G7 soft: order-detail route) | Not started |
| EXT-005 | Excel/CSV ommaviy import / Bulk catalog import | G1, G2 | Not started |
| EXT-006 | Barcode katalog matching / Barcode catalog matching | G1, G2 | Not started |

Rationale: EXT-001 is pure buyer+catalog data (`comparison_lists` reference variants/attributes) — needs Global Catalog (G2) only, no seller actor. EXT-002/003/005/006 all have a Seller actor, so each needs Seller onboarding (G1, an account/role must exist before a seller can configure alerts, answer questions, import a sheet, or resolve a barcode scan) on top of Catalog (G2); EXT-005 and EXT-006 also directly extend existing G2 capabilities (see conflicts section below). EXT-004 is the outlier and sets R1's gate: "verified purchase" + `delivered_at` requires an order item (G4, Orders) to have actually reached delivered status via shipment proof (G6, Logistics/`LOG-007`) — so EXT-004, and therefore all of R1 as a release, cannot be fully built until G6 lands, even though 5 of its 6 features only need G1+G2.

### R2 (7 features)

| ID | Feature (uz) / gloss (en) | Depends on (G-milestone) | Status |
|---|---|---|---|
| EXT-007 | Raqobatchi narxlari / Competitor price benchmarks | G1, G2 | Not started |
| EXT-008 | 1C/Odoo/POS API integratsiya / ERP-POS integration | G1, G2, G3 | Not started |
| EXT-009 | Foyda-xarajat analitikasi / Profit & cost analytics | G1, G5 (hard); G6 (soft — shipping-cost line item) | Not started |
| EXT-010 | PVZ (Longrich + hamkor) / Pickup points, own + partner | G6 | Not started |
| EXT-011 | QR buyurtmani topshirish / QR order handover | G6; same-release dependency on EXT-010 | Not started |
| EXT-012 | Qaytarilgan mahsulotlar QC / Returns QC & disposition | G5, G6 | Not started |
| EXT-013 | Mahsulot bundle va komplekt / Product bundles/kits | G1, G2, G3, G4 | Not started |

Rationale: EXT-007 needs only public offer data (G2) plus a seller actor viewing it (G1). EXT-008 is the detailed spec of the "ERP — Seller inventory sync" row already listed (unvalidated) in `12_Integrations.csv` — it syncs catalog/offers (G2) and stock (G3), so both gate it. EXT-009's hard floor is the ledger (G5, "net margin reconciles to ledger" is explicit); the shipping-cost component is a softer tie to G6 and the ads-cost component has a **forward reference to EXT-016 (R3)** — see Cross-extension dependencies below; this is handled gracefully by EXT-009's own `INCOMPLETE_DATA`/`PARTIAL` state, not a blocker. EXT-010 is exactly the task's own worked example: PVZ pickup is a specialized final-mile delivery method and its state model (`IN_TRANSIT`, `READY_FOR_PICKUP`) only makes sense once shipments/tracking (G6) exist; note that "PVZ Partner" is a *new* actor/tenant type, not literally the same as a Seller, so this item is **not** marked as depending on G1 — its own onboarding flow is new work inside EXT-010, flagged here rather than assumed. EXT-011 explicitly requires a shipment to reach `DELIVERED` with proof (G6, `LOG-007`) and cannot exist before EXT-010 (same release, sequencing note not a G-gate). EXT-012 sits exactly on the existing Return state machine's `INSPECTED` step (`13_State_Machines.csv`: `REQUESTED > UNDER_REVIEW > APPROVED > IN_TRANSIT > INSPECTED > ...`) which spans Returns workflow (G5, `OPS-001`, the ticket-level `APPROVED`) and Return inbound (G6, `FUL-012`, the physical `IN_TRANSIT`/`INSPECTED` handling) — both are hard gates. EXT-013 needs catalog/offers (G2), atomic multi-item reservation (G3, `INV-002`), and checkout (G4) to let a buyer actually buy a bundle.

### R3 (6 features)

| ID | Feature (uz) / gloss (en) | Depends on (G-milestone) | Status |
|---|---|---|---|
| EXT-014 | AI tavsif va SEO / AI description & SEO generation | G1, G2 (+ G7 soft: `OPS-006` SEO pages) | Not started |
| EXT-015 | Ombor qoldig'i prognozi / Inventory forecasting | G1, G3, G4 | Not started |
| EXT-016 | Seller reklama kabineti / Seller ads cabinet | G1, G2, G5 | Not started |
| EXT-017 | Referral bonus / Referral bonus program | G4, G5, G6 | Not started |
| EXT-018 | Rasm orqali qidirish / Visual (image) search | G2 | Not started |
| EXT-019 | Avtomatik repricing / Automated repricing | G1, G2; cross-release dependency on EXT-007 (R2) and EXT-002 (R1) | Not started |

Rationale: EXT-014 writes AI-generated content into the product description, which lives in Catalog (G2); its SEO-specific output (meta/structured data) consumes `OPS-006` (G7), which is flagged as **soft, not hard** — the feature can publish to the description field before full G7 SEO pages exist, so this is noted as an ambiguity rather than asserted as a hard block. EXT-015 needs stock levels (G3) and sales/order history (G4) as its forecasting inputs. EXT-016 needs active offers to advertise (G2) and bills through the finance ledger (G5, `ad_spend_ledger`), per the extensions doc's own global rule that ad/bonus events "connect to finance ledger, never arbitrary balance writes." EXT-017 needs a qualifying delivered purchase (G4 orders reaching delivered status via G6 shipment proof, same pattern as EXT-004) and posts bonuses through the ledger (G5) — no Seller actor here, so G1 is correctly **not** listed. EXT-018 is pure catalog/embeddings (G2), no seller actor. EXT-019's own text explicitly anchors to "benchmark" data and treats manual price edits as audit events against price history — i.e. it is **not buildable** until EXT-007 (R2, competitor benchmarks) and EXT-002 (R1, append-only price history) exist, which is a real cross-extension/cross-release dependency, separate from and in addition to its G-milestone floor (G2).

**Note on R3 vs. R2 ordering:** R3's own G-milestone ceiling (G6, via EXT-017) is no higher than R2's. R3 is sequenced after R2 by product/dependency reasons — AI infrastructure build-out (not covered by any G0–G9 milestone, flagged as net-new infra the architect will need to scope separately) and the explicit cross-extension dependency of EXT-019 on EXT-007/EXT-002 — not because it needs a later backend milestone.

### R4 (3 features)

| ID | Feature (uz) / gloss (en) | Depends on (G-milestone) | Status |
|---|---|---|---|
| EXT-020 | Live Shopping / Live-stream commerce | G1, G2, G3, G4 | Not started |
| EXT-021 | B2B ulgurji savdo / B2B wholesale | G1, G2, G3, G4, G5 | Not started |
| EXT-022 | Seller mobil ilovasi / Seller mobile app | G1, G2, G3, G6 | Not started |

Rationale (matches the task's own worked examples): EXT-020 needs seller eligibility (G1), server-verified current price/stock (G2/G3), and normal checkout (G4) for the "quick cart → normal checkout" step. EXT-021 — per the task's own example — needs Orders/Checkout (G4) and Finance/Ledger (G5), on top of offers (G2) and a stock re-check at order time (G3); note "Business Buyer" (`business_accounts`) is a **wholly new account/KYB type**, not the same as the existing Buyer (WEB) or Seller (SEL) onboarding — EXT-021 must build its own business-account verification, flagged here rather than assumed to reuse G1's seller KYB flow. EXT-022 — per the task's own example — depends on the Seller Portal backend existing (G1) plus its own sync layer (new), but concretely it also *surfaces* `SEL-007` Seller order queue (G6) and catalog/inventory data (G2/G3) on a mobile client, so G6 is its real ceiling.

### Cross-extension dependencies (not G-milestone gates, but real sequencing constraints — flagged for the backlog, not resolved here)

- **EXT-011 (R2) requires EXT-010 (R2)** — QR handover only makes sense at a pickup point that already exists.
- **EXT-019 (R3) requires EXT-007 (R2) and EXT-002 (R1)** — automated repricing needs competitor benchmarks and price-history infra to anchor against.
- **EXT-009 (R2)'s "ads" cost line soft-references EXT-016 (R3)** — a later release's data feeding an earlier release's report. Not a blocker (EXT-009's own `INCOMPLETE_DATA` state covers it), but worth sequencing awareness if EXT-009 ships before EXT-016.

---

## Conflicts / overlaps between the extensions doc and the original TZ (reconciled 2026-10-18)

Per the same reconciliation policy already established above for the blueprint-vs-spreadsheet ID drift, these are **flagged and reconciled explicitly**, not silently treated as unrelated net-new features:

1. **EXT-006 (Barcode katalog matching) extends, not duplicates, `CAT-004` (Barcode MXIK) + `CAT-006` (Duplicate resolution) + `BR-CAT-03`** ("Barcode collision auto merge emas, conflict review"). The original TZ already specified: a barcode/MXIK field on variants (`CAT-004`, G2), a duplicate-candidate detection + moderator-merge workflow (`CAT-006`, G2), and the exact business rule EXT-006 restates almost verbatim ("conflict requires review," "Same GTIN conflicting variants blocks automatic merge" = `BR-CAT-03`). EXT-006 adds a seller-facing scan-to-offer UX, an explicit state model (`EXACT_MATCH/MULTIPLE_CANDIDATES/NOT_FOUND/REVIEW_REQUIRED`), and new supporting tables (`product_identifiers`, `barcode_scan_events`, `catalog_match_candidates`, `product_merge_cases`) on top of what `CAT-004`/`CAT-006` already cover. **Reconciliation:** when G2 builds `CAT-004`/`CAT-006`, name/shape the identifier and merge-case tables so EXT-006 can extend them in R1 rather than building a second, parallel barcode-matching data model. **Status as of G2 ticket-writing (2026-10-18): done** — `T-G2-4` (identifiers) and `T-G2-6` (merge cases) build `product_identifiers`/`product_merge_cases` using exactly EXT-006's own proposed table names, so R1's EXT-006 extends them rather than duplicating them.

2. **EXT-005 (Excel/CSV ommaviy import) is very likely the same feature as `CAT-008` (Bulk import)**, re-specified in much greater detail. `CAT-008`'s one-line spreadsheet description ("CSV/XLSX mapping, per-row errors," G2) and EXT-005's full state machine (`UPLOADED→VALIDATING→READY→IMPORTING→COMPLETED→PARTIAL→FAILED`, per-seller SKU dedup, global product matching, background jobs, templates, admin file/rate limits) describe one capability at two different levels of detail, approved roughly in parallel. **Reconciliation:** treat EXT-005 as the authoritative, detailed spec for what `CAT-008` should be built as in G2 — i.e. when G2 lands, build `CAT-008` directly to the EXT-005 state model rather than building a shallow version in G2 and redoing it for R1. This avoids double-building the same import pipeline twice. **Status as of G2 ticket-writing (2026-10-18): done** — `T-G2-8` is written directly to EXT-005's state machine, not a shallow placeholder.

3. **EXT-002 (Narx tarixi va bildirishnomalar) extends `CAT-009` (Price history) / `BR-CAT-04`** ("Historical price snapshots immutable"). `CAT-009` (G2) already commits to append-only price history storage; EXT-002 adds multi-period charts, a distinct product-level benchmark vs. offer-level history, price-target alerts with dedupe, and retention/archive policy on top of the same append-only invariant. **Reconciliation:** the table EXT-002 proposes as `offer_price_history` should be treated as the natural evolution/rename of whatever table `CAT-009` creates in G2, not a second price-history table — flag this at G2 design time so the column/partitioning choice anticipates EXT-002's 7/30/90/365-day query patterns. **Status as of G2 ticket-writing (2026-10-18): done** — `T-G2-1` names the table `offer_price_history` directly (EXT-002's own proposed name, no rename needed later) and `T-G2-5`'s acceptance criteria call out anticipating the 7/30/90/365-day access pattern.

4. **EXT-012 (Qaytarilgan mahsulotlar QC) is the detailed specification of the `INSPECTED` step already present in the core Return state machine** (`13_State_Machines.csv`: `... > IN_TRANSIT > INSPECTED > REFUND_PENDING > ...`), and sits between `OPS-001` (Returns workflow, G5 — the ticket-level request/approval) and `FUL-012` (Return inbound, G6 — the physical movement) plus reuses the inbound-QC pattern from `FUL-005`/`BR-FUL-02` ("QC rejected stock unsellable"). This is confirmed at the event level too: the core event catalog's `return.approved.v1` (published by OPS, consumed by FUL) is exactly what EXT-012's own new event `return.qc_completed.v1` chains after. **Reconciliation:** not a duplicate — a real gap-fill between two already-planned core milestones. No conflict to resolve, but the dependency chain (`OPS-001` ticket approved → `FUL-012` physical receipt → EXT-012 inspection/disposition) should be made explicit in whichever ticket builds each piece, so EXT-012 isn't built as an island with its own parallel "return received" concept.

5. **EXT-008 (1C/Odoo/POS API integratsiya) is the detailed specification of the "ERP — Seller inventory sync" integration row already listed (and already flagged unvalidated) in `12_Integrations.csv`.** Not a new integration target the original TZ was silent on — it's the first time that placeholder row gets a real spec (connection/credentials/field-mapping/sync-job state machine, specific to 1C/Odoo/POS systems). **Reconciliation:** treat `12_Integrations.csv`'s "ERP" row as satisfied by EXT-008's spec going forward; no separate generic-ERP ticket is needed alongside it.

6. **EXT-004 (Foto/video sharhlar) fills a gap the original TZ implied but never specified.** The spreadsheet's `WEB-003` (Product detail, G7) detailed requirement literally lists "sharh" (review) as a UI element on the product page, but no module in the original 12 anywhere specifies a review/rating backend, moderation flow, or verified-purchase rule. EXT-004 is the first real specification of that capability. **Not a duplicate or conflict** — but flagged so that whoever eventually builds `WEB-003` (G7) knows it is consuming EXT-004's API (`GET /v1/products/{id}/reviews`), not inventing its own ad hoc review display.

7. **EXT-009 (Foyda-xarajat analitikasi) is adjacent to, not a duplicate of, `SEL-008` (Seller finance views, G5)**. `SEL-008` covers commission/statement/payout visibility (money the platform already tracks in the ledger); EXT-009 is a seller-private cost/margin analytical layer (COGS, expenses, ad spend, allocation rules) that the seller enters themselves and that the platform never sees as ledger entries. **Reconciliation:** no overlap to resolve — just note EXT-009 should read from the same ledger `SEL-008` exposes (for the revenue/commission/refund side of the margin calculation) rather than re-deriving those figures independently.

8. **EXT-010 (PVZ) and EXT-016 (Seller reklama kabineti) are not scope creep — they are exactly the features TZ §01 itself names as deferred extension points.** TZ §01 states: "O'z mahsulotini sotish (1P), pickup point, reklama, BNPL va seller subscription keyingi bosqichlar uchun extension point; MVP asosiy qamroviga avtomatik kiritilmasin" (pickup point, ads, BNPL, and seller subscription are extension points for later phases; not automatically part of MVP core scope). EXT-010 (pickup points) and EXT-016 (ads) are precisely those two extension points now being specified. **No conflict — confirms the extensions doc is executing the original TZ's own stated roadmap**, not introducing unplanned scope. (BNPL and seller subscription, also named in that same TZ §01 sentence, do **not** appear anywhere in the 22 EXT items — flagged as a gap for visibility: either they remain genuinely un-scheduled, or they were intentionally dropped from v2.4; this matrix does not guess which, see Open Questions.)

9. **No conflict found:** B2B/wholesale (EXT-021) does not appear anywhere in the master blueprint or the spreadsheet (`grep` for "wholesale"/"B2B"/"ulgurji" returns nothing) — genuinely net-new, not a re-spec of an existing requirement.

10. **No event-name collisions** between the core `11_Event_Catalog.csv` (`order.created.v1`, `payment.succeeded.v1`, `return.approved.v1`, etc.) and the extensions doc's own "CROSS-MODULE EVENT CATALOG" (`review.submitted.v1`, `offer.price_changed.v1`, `return.qc_completed.v1`, etc.) — the two lists are disjoint and, where related, chain correctly (see #4 above).

## Grand totals (updated 2026-10-18)

110 core requirement IDs (12 modules) + 22 extension requirement IDs (`EXT-001..022`, R1–R4) = **132 requirement IDs** tracked in this matrix. All 22 extension IDs are "Not started." No tickets have been cut for the extension track yet — see `docs/open-questions.md` and the PM process note: that is intentional, deferred until R1 is actually approaching buildability (i.e. until G1/G2/G4/G6 land for R1's features), not an oversight.
