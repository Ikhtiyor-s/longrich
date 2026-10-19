# T-G1-6 — Seller profile / shop settings

**Requirement refs:** TZ §06 (`SEL-004` store settings — canonical spreadsheet ID; blueprint's own numbering calls this `SEL-005` "shop profile"), §28 (public store `display_name` max120), §29 ("seller cannot publish while non-ACTIVE"), §31 (`GET/PATCH /v1/seller/profile`). Requirement ID: `SEL-004`. Milestone: G1.

**Migration:** None, if `T-G1-1`'s `sellers` columns already cover every profile field this ticket needs (`display_name` + whatever else TZ §06 implies, e.g. description/logo reference). If additional columns turn out to be needed, this ticket adds its own small additive migration and must say so explicitly in the PR rather than assume `T-G1-1` already covered it.

## Goal
Let a seller OWNER/MANAGER view and edit their shop's public-facing profile fields, with "publish" of those fields restricted to sellers whose status is ACTIVE.

## Files likely touched
- `apps/api/src/modules/sellers/profile/` — controller, service, DTOs

## How we'll know it's done
- `GET /v1/seller/profile` returns the caller's own seller's profile; a non-member gets `403`/`404`.
- `PATCH` enforces `display_name` ≤ 120 chars; `legal_name`/`tax_id`/`legal_type` are **not** editable here (those are `SEL-001`'s domain, kept to one write path).
- `PATCH` succeeds regardless of status (DRAFT through ACTIVE), but any change to a field flagged as "publish-affecting" is rejected `422` unless `sellers.status = ACTIVE`, per TZ §06.
- Only `OWNER`/`MANAGER` (per `T-G1-4`'s `seller_members`) may `PATCH`; `OPERATOR` → `403`.
- Every profile change writes an audit log entry (before/after) via the existing G0 `AuditService` — no new logging mechanism.

## Owner role
`backend-dev`

## Depends on
T-G1-2, T-G1-4, T-G1-5
