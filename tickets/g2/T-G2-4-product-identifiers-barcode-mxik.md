# T-G2-4 — Product identifiers: GTIN/EAN/UPC barcodes + MXIK/IKPU tax classification reference

**Requirement refs:** TZ §07 blueprint `CAT-005` (GTIN/EAN/UPC/barcodes) + `CAT-006` (MXIK/IKPU tax classification reference) — both fold into canonical `CAT-004` "Barcode MXIK" per `docs/traceability.md`. §28 (GTIN checksum validation, "MXIK reference classification version"). Requirement ID: `CAT-004`. Milestone: G2.

**Open question (flagged, not guessed — new entry added to `docs/open-questions.md` #32 by this PM pass):** the authoritative source/format/update-cadence for Uzbekistan's MXIK/IKPU tax classification code list is not named anywhere in the TZ. This ticket stores a versioned MXIK code + the classification-list version it was checked against, but does **not** build a live lookup/validation integration against any external register until that source is confirmed.

**Forward reference (DES, non-authoritative):** DES-007 shows GTIN + MXIK in a "Texnik ma'lumotlar" tab "where verified." DES-014's seller barcode-scan-to-offer flow (EXT-006, R1) is expected to extend this ticket's `product_identifiers` table rather than build a parallel one — per `docs/traceability.md`'s extensions-conflicts reconciliation note #1, table/column naming here anticipates that.

**Migration:** none — uses `T-G2-1`'s `product_identifiers` table.

## Goal
Let an admin attach checksum-validated GTIN/EAN/UPC barcode identifiers and a version-tagged (not live-validated) MXIK/IKPU classification code to a product variant, using the single `product_identifiers(type, value)` table.

## Files likely touched
- `apps/api/src/modules/catalog/identifiers/`

## How we'll know it's done
- A GTIN/EAN/UPC value that fails its checksum is rejected `422`, never stored.
- The same `(type, value)` pair cannot be silently attached to two different variants: attempting it creates a `product_merge_cases` candidate row (consumed by `T-G2-6`) instead of either overwriting the existing identifier or letting two canonical variants silently claim the same real-world barcode — "GTIN conflict creates review case, not destructive merge" (TZ §07) proven here at the detection point.
- MXIK code is stored with an explicit `classification_version` field; no endpoint response claims the code has been validated against a live external MXIK register (blocked on `docs/open-questions.md` #32).
- The `product_identifiers(type, value)` hot index (from `T-G2-1`) is demonstrably used by the conflict-check query (EXPLAIN-backed or equivalent test), not just present-but-unused.
- Non-admin caller gets `403`.

## Owner role
`backend-dev`

## Depends on
T-G2-1, T-G2-3
