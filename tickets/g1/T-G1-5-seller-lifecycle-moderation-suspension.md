# T-G1-5 — Seller lifecycle moderation: approval workflow + suspension/reinstatement

**Requirement refs:** TZ §06 (`SEL-003` seller approval — canonical spreadsheet ID; blueprint's own numbering calls this "bank info verification" at `SEL-003` and "seller approval" is elsewhere in blueprint prose — see `docs/traceability.md`'s "Known conflict" section for this exact drift), §29 (SUBMITTED→UNDER_REVIEW→APPROVED/NEEDS_CHANGES/REJECTED; ACTIVE↔SUSPENDED "reinstatement controlled"), §34 (Moderator can review seller/catalog but cannot post ledger). Requirement IDs: `SEL-003`, `SEL-009` (seller suspension), `ADM-002` (Seller management — folds suspend/reinstate per `docs/traceability.md`'s existing fold note). Milestone: G1.

**Migration:** None. Status enums already defined in `T-G1-1`; this ticket is pure state-transition/permission logic.

## Goal
Let a `MODERATOR` move a SUBMITTED application through UNDER_REVIEW to APPROVED/NEEDS_CHANGES/REJECTED with a recorded reason and reviewer, flip APPROVED→ACTIVE as its own step, and let an authorized admin suspend/reinstate an ACTIVE seller.

## Open design notes — flagged, not guessed (also logged in `docs/open-questions.md` #28/#29)
- **APPROVED→ACTIVE trigger:** TZ states the pipeline as a straight arrow but never specifies what separates the two states. This ticket implements it as its own explicit, idempotent, separately-audited transition (same reviewer action) rather than silently merging it into the approval decision.
- **Who may suspend/reinstate:** TZ names Moderator's scope as "seller/catalog approvals" but never names who is authorized to suspend an *already-active* seller — a more sensitive action. This ticket defines a distinct permission code `seller:suspend` (separate from `seller:moderate`) and the seed (`T-G1-1`) grants it only to `SUPER_ADMIN` as the narrowest safe interim default, reassignable later with no code change via the existing `admin_role_permissions` grant mechanism.

## Files likely touched
- `apps/api/src/modules/sellers/moderation/` — controller, service, DTOs (approve/reject/needs-changes, activate)
- `apps/api/src/modules/sellers/suspension/` — controller, service (suspend/reinstate)

## How we'll know it's done
- A review action requiring `seller:moderate` permission (`403` for a `SUPPORT_AGENT`-roled caller, `200` for the seeded `MODERATOR` from `T-G1-1`) transitions UNDER_REVIEW→APPROVED, records the reviewer id, emits an outbox event (e.g. `seller_application.approved.v1`).
- REJECT/NEEDS_CHANGES require a non-empty reason; the applicant can read that reason via `T-G1-2`'s `GET`.
- A second, explicit APPROVED→ACTIVE action flips `sellers.status`, independently audited from the approval decision.
- `POST /v1/sellers/{id}/suspend` requires `seller:suspend` (`403` for `MODERATOR` alone, `200` for `SUPER_ADMIN`), valid only from ACTIVE, requires a reason, emits `seller.suspended.v1`. `POST /v1/sellers/{id}/reinstate` reverses it, SUSPENDED→ACTIVE only.
- Invalid transitions (e.g. suspending a DRAFT seller, re-approving an already-APPROVED one) return `409 INVALID_STATE_TRANSITION`, never a silent no-op.
- Completion note explicitly states: enforcement of "suspended seller cannot publish/transact" against real offers/orders is deferred to G2/G4 (those tables don't exist yet); "existing orders handled by cancellation/fulfillment policy" on suspension is deferred to G4's order-cancellation design — this ticket only flips the seller-entity state and emits the event other modules will eventually react to.

## Owner role
`backend-dev`

## Depends on
T-G1-2, T-G1-3
