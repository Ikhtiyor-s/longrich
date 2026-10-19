# T-G1-7 — Seller operations dashboard shell: offer/inventory/order surface (permission + shell only)

**Requirement refs:** TZ §06 (`SEL-007` blueprint numbering — "offers/stock/orders" lumped as one item; the canonical spreadsheet mapping used in `docs/traceability.md` splits this into `SEL-006` "Seller offer tools" pinned to G2 and `SEL-007` "Seller order queue" pinned to G6). Requirement IDs: `SEL-006`, `SEL-007`. Milestone: G1 for this ticket's scope only — the real data capabilities stay pinned to G2/G3/G4/G6 as already recorded in `docs/traceability.md`.

**Migration:** None. Pure RBAC/permission-wiring + a placeholder response shape — this ticket must not create or touch any `catalog`/`offers`/`inventory`/`orders`/`fulfillment` module tables, all of which are still empty stub folders per ADR-001 (G2/G3/G4/G6 scope).

## Why this ticket exists and what it deliberately does NOT build
The actual Catalog/Offers data model (G2) and Inventory data model (G3) don't exist yet, and Orders/fulfillment (G4/G6) don't either. Building a real "manage my offers" or "my order queue" feature now would require inventing G2/G3/G4 tables ahead of their own milestones, which this ticket explicitly refuses to do. What G1 *can* deliver now: the seller-side permission codes (`seller:offers:manage`, `seller:inventory:view`, `seller:orders:view`, or similar) gated by `seller_members.role` (from `T-G1-4`), and a dashboard-shell endpoint sellers can call today that returns a clearly-labeled "not yet available" placeholder for each section — so that when G2/G3/G4/G6 land, they attach real queries behind permission checks that already exist instead of redesigning seller-side RBAC a second time.

## Goal
Define the seller-side permission codes for offer/inventory/order management and ship a dashboard-shell endpoint that reflects them, with every section explicitly marked as backed by a future milestone, not real data.

## Files likely touched
- `apps/api/src/modules/sellers/dashboard/` — controller, service
- Permission code registration (reuses `T-G1-1`'s/`T-G1-4`'s permission mechanism, no new table)

## How we'll know it's done
- `GET /v1/seller/dashboard` returns a response where each section (offers, inventory, orders) includes an explicit marker (e.g. `status: "NOT_AVAILABLE"`, with a note naming the milestone that will populate it: G2 for offers, G3 for inventory, G4/G6 for orders) rather than a fabricated zero or empty-array that could be mistaken for "there's genuinely nothing here."
- Permission codes `seller:offers:manage`/`seller:inventory:view`/`seller:orders:view` exist and are gated by `seller_members.role` exactly like other seller permission checks from `T-G1-4` — `OPERATOR` can view (per TZ §02 "pick/dispatch limited") but not manage offers.
- A non-member of the seller gets `403` on this endpoint, same as every other seller-scoped endpoint in this milestone.
- The seller's current lifecycle status (DRAFT/SUBMITTED/.../ACTIVE/SUSPENDED, from `T-G1-5`) is surfaced in the dashboard response so a non-ACTIVE seller sees why the operational sections are inert, rather than a bare permission error.
- PR explicitly lists which G2/G3/G4/G6 tables this ticket did **not** touch, as a guardrail against scope creep into those milestones.

## Owner role
`backend-dev`

## Depends on
T-G1-4, T-G1-5
