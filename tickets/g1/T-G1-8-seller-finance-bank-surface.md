# T-G1-8 — Seller finance/statement view surface + bank account management (deferred-ledger-aware)

**Requirement refs:** TZ §06 (`SEL-008` finance statement — canonical spreadsheet ID; blueprint's own numbering calls this `SEL-009`; blueprint's own `SEL-003` "bank info verification" sub-item has no standalone canonical ID and is folded in here as the finance-adjacent home for `seller_bank_accounts`), §28 (bank information encrypted/masked), §34 ("Seller operator... no payout or bank data"; "Seller owner can propose bank detail changes... sensitive bank changes trigger review"). Requirement ID: `SEL-008`. Milestone: G1 for this ticket's scope — the real ledger/statement data stays pinned to G5 as already recorded in `docs/traceability.md`.

**Migration:** None. `seller_bank_accounts` already exists from `T-G1-1`.

## Why this ticket exists and what it deliberately does NOT build
The real commission/ledger/payout system is G5 scope and doesn't exist yet. This ticket does not invent ledger tables or balances. What it *does* build now: (1) a permission-gated finance-summary endpoint that returns an explicit "not yet available" placeholder (same convention as `T-G1-7`), reserving the shape for G5 to fill in later without a breaking API change, and (2) real `seller_bank_accounts` CRUD — propose/view a masked bank reference, with a review trigger on sensitive changes — since that table and its security rule (TZ §28/§34) are fully specifiable now and don't depend on G5's ledger.

## Files likely touched
- `apps/api/src/modules/sellers/finance/` — controller, service, DTOs (summary placeholder, bank account propose/view)

## How we'll know it's done
- `GET /v1/seller/finance/summary` returns a placeholder response (`status: "NOT_AVAILABLE"`, noting G5 as the milestone that populates real figures); accessible only to `OWNER`/`MANAGER` — `OPERATOR` → `403` per TZ §34 "no payout or bank data."
- `GET /v1/seller/bank-accounts` returns the seller's bank reference **masked** (e.g. only last 4 digits visible); the underlying `encrypted_reference` is never returned in plaintext in any response.
- `POST /v1/seller/bank-accounts` (propose a new/changed bank reference) is `OWNER`-only (TZ §34: "owner can propose bank detail changes"), creates the row with `verified = false`, and triggers a review case reusing `T-G1-5`'s reviewer/moderation pattern rather than inventing a second review mechanism — "sensitive bank changes trigger review" per TZ §06's acceptance criterion.
- Approving/rejecting a bank-account review requires the same `seller:moderate`-family permission used in `T-G1-5`, proven by an integration test.
- `tax_id`/bank-reference leading-zero preservation (already proven at the schema level in `T-G1-1`) is re-verified end-to-end through this endpoint's request/response cycle.

## Owner role
`backend-dev`

## Depends on
T-G1-1, T-G1-4, T-G1-5
