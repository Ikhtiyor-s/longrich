# T-G1-2 — Seller application intake: legal entity capture, contract acceptance, submit

**Requirement refs:** TZ §06 (`SEL-001` application legal entity; blueprint's "contract acceptance/e-sign integration where applicable" sub-item — folded into this ticket, see note below), §28 (field validation: `legal_type`, `tax_id` string with leading zeros, `legal_name` max255, display name max120, contract acknowledgement required to submit), §29 (DRAFT→SUBMITTED transition), §31 (`POST /v1/seller-applications`, `POST /{id}/submit`). Requirement ID: `SEL-001`. Milestone: G1.

**Migration:** None. Builds entirely on `T-G1-1`'s tables.

**Note on ID folding:** blueprint §06 lists "contract acceptance/e-sign integration where applicable" as its own numbered sub-item, but the canonical spreadsheet-based ID mapping already adopted in `docs/traceability.md` has no separate ID for it. Per TZ §28's own text ("Seller can submit only required docs and contract acknowledgement"), contract acceptance is a precondition of `SEL-001`'s submit transition, not a standalone capability — folded into this ticket's scope, consistent with `docs/traceability.md`'s existing fold policy (e.g. CSV import → `CAT-008`).

## Goal
Let an applicant create a DRAFT seller application capturing legal-entity fields, edit it while DRAFT, record contract acknowledgement, and submit it (DRAFT→SUBMITTED) once required documents and contract acceptance are in place.

## Files likely touched
- `apps/api/src/modules/sellers/applications/` — controller, service, DTOs
- `apps/api/src/modules/sellers/sellers.module.ts` — wire the new controller/providers

## How we'll know it's done
- `POST /v1/seller-applications {legal_type, tax_id, legal_name, display_name, contacts}` atomically creates a `sellers` row (DRAFT) + `seller_applications` row (DRAFT), returns `201`; `legal_name` > 255 chars or `display_name` > 120 chars rejected `422`; a `tax_id` with a leading zero is stored and echoed back unchanged; unauthenticated request → `401`.
- `PATCH` edits succeed only while DRAFT; attempting to `PATCH` after SUBMITTED returns `409 INVALID_STATE_TRANSITION`, not a silent no-op.
- A contract-acceptance action records a `seller_contracts` row (version, `accepted_at`) against the application's current contract version; historical contract versions are kept, never overwritten.
- `POST /{id}/submit` transitions DRAFT→SUBMITTED only when required `seller_documents` rows exist (this ticket's tests may insert document rows directly as fixtures — it does not need `T-G1-3`'s upload endpoint to exist to prove this gate) **and** a `seller_contracts` acceptance row exists; otherwise `422` with an explicit reason, matching TZ §06's "incomplete KYB cannot submit."
- Cross-seller `403`: a caller cannot `PATCH` or submit another applicant's application (ownership check against the application's seller).
- An outbox event (e.g. `seller_application.submitted.v1`, versioned per ADR-001's convention) is emitted on successful submit even though no other module consumes it yet.

## Owner role
`backend-dev`

## Depends on
T-G1-1
