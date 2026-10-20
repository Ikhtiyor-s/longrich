# Longrich Marketplace — Open Questions (External / Legal / Business Dependencies)

Source: TZ §24 "EXTERNAL DECISIONS AND LEGAL DEPENDENCIES" (verbatim list), cross-checked against `docs/source/prd-spreadsheet/09_Risk_Register.csv`, `12_Integrations.csv`, `14_Sources.csv`. TZ §26 and §36 require every one of these to be parked here rather than guessed by any implementing agent, human or AI. Nothing below should be "resolved" by inventing a plausible-sounding answer in code or docs — only by an actual contract, legal opinion, or credential handoff from the business owner.

Severity tags (BLOCKER / HIGH / MEDIUM) are carried from `09_Risk_Register.csv` where the item maps 1:1; items with no spreadsheet risk row are tagged `UNRATED` and should get a severity once reviewed.

---

### 1. Merchant-of-record identity
**Unconfirmed:** Who legally sells to the end customer and collects payment — the marketplace operator, or each seller individually (classic 3P marketplace-of-record question) — is not decided.
**Needed to resolve:** Legal/tax counsel opinion + commercial agreement with Click/Payme defining settlement party.
**Interim:** Do not hardcode a merchant-of-record assumption anywhere (ledger account ownership, invoice templates, OFD receipt issuer). Design `ledger_accounts.owner_type` generically enough to support either model without a schema rewrite. **Severity: BLOCKER.**

### 2. PSP multi-seller settlement / split support
**Unconfirmed:** Whether Click and/or Payme actually support splitting a single customer payment across multiple seller payees, or whether the marketplace must collect-then-disburse manually.
**Needed to resolve:** Signed technical contract/API docs from Click and Payme confirming split-payment or sub-merchant capability (TZ §15/§32: "Actual refund and split-payment capability must be contract-confirmed; if unavailable, manual settlement workflow").
**Interim:** Payment adapters run in sandbox/mock mode (TZ §25/§36 explicit instruction); ledger design assumes collect-then-disburse (marketplace holds funds, pays out via `settlements`/`payouts`) as the safe default until split is confirmed either way. **Severity: BLOCKER.**

### 3. Payout hold / settlement trigger
**Unconfirmed:** What event legally and operationally triggers releasing a seller's held balance to "available" for payout (delivery confirmation? return-window expiry? fixed T+N days?).
**Needed to resolve:** Business policy decision, likely informed by the merchant-of-record and PSP settlement answers above.
**Interim:** `FIN-004` seller balance states (pending/available/held) are modeled but the transition rule stays a configurable policy, not a hardcoded constant. No payout ships until this is confirmed. **Severity: HIGH.**

### 4. Exact commission base and discount funding
**Unconfirmed:** Whether commission is computed on gross item price, net-of-discount price, or price-plus-shipping; who funds promotional discounts (platform vs. seller) when commission is calculated.
**Needed to resolve:** Finance/business sign-off on the commission formula per TZ §10/§32 ("split discount funding and shipping fees explicit").
**Interim:** `commission_calculations.eligible_amount_minor` stays an explicit, separately-stored snapshot field so the formula can be corrected later without touching historical orders (TZ: "rule edits don't mutate historical orders"). **Severity: BLOCKER** (directly tied to #1/#2).

### 5. Fiscalization and receipts (OFD)
**Unconfirmed:** Uzbekistan OFD/fiscal cheque requirements for a multi-seller marketplace — who issues the fiscal receipt (platform or seller), what data it must contain, which checkout step it fires on.
**Needed to resolve:** Tax/regulatory review against current OFD rules; integration validation per `12_Integrations.csv` ("OFD — Fiscal receipts — Validate regulation").
**Interim:** Order/payment data model keeps immutable snapshots (price, tax, title) so a fiscal receipt can be generated retroactively once the rule is known; no fiscal integration is built until confirmed. **Severity: BLOCKER.**

### 6. Identity / legal onboarding required fields (seller KYB)
**Unconfirmed:** Exact set of legal fields Uzbekistan requires to onboard a seller business (legal_type enum values, required STIR/tax_id format, required licenses per category) — TZ §28 flags `legal_type` as "enum" without enumerating the values.
**Needed to resolve:** Legal review of what business registration types are eligible to sell (individual entrepreneur vs. LLC vs. other), and what documents each requires.
**Interim:** `seller_applications`/`seller_documents` schema stores `type` and `legal_type` as extensible lookups, not a fixed hardcoded enum baked into business logic, so the field list can be corrected before G1 ships without a destructive migration. **Severity: HIGH.** Reaffirmed during G1 ticket-writing (2026-10-18): `T-G1-1` implements `legal_type` as a string/lookup column, not a native Prisma enum, specifically because this item is still open.

### 7. Prohibited or restricted categories
**Unconfirmed:** Which product categories are banned outright (e.g., weapons, pharma, alcohol-equivalent restrictions in UZ e-commerce law) and which require extra certification (TZ §07: "Restricted categories demand additional certification rules").
**Needed to resolve:** Legal/compliance review against Uzbekistan e-commerce and category-specific regulation (see `napp.uz` register of electronic commerce operators, `14_Sources.csv`).
**Interim:** Category moderation workflow (CAT-007/CAT-011 in blueprint numbering) includes a generic "requires additional certification" flag at the category level so restricted categories can be configured once the list exists; no categories are pre-seeded as restricted/banned by guesswork. **Severity: HIGH.**

### 8. Return statutory periods
**Unconfirmed:** The legally mandated minimum return/refund window(s) in Uzbekistan consumer protection law, and whether it varies by category.
**Needed to resolve:** Legal review of applicable consumer protection statute.
**Interim:** `BR-OPS-02` ("Return windows follow law and category policy") stays a configurable policy value per category, not a hardcoded number. **Severity: HIGH.**

### 9. Data residency / privacy rules
**Unconfirmed:** Whether Uzbekistan law requires personal data (phone numbers, addresses, payment metadata) to be stored on servers physically/legally within Uzbekistan, and what consent/retention rules apply.
**Needed to resolve:** Legal review of UZ personal data protection law as applied to this specific data set (customer PII, seller KYB docs, payment references).
**Interim:** Infra design (TZ §20) keeps environments and backups isolated and documented so a residency constraint can be satisfied by choosing hosting location without an architecture change; no cloud region is committed yet. **Severity: UNRATED — recommend HIGH given PII + payment data volume.**

### 10. Courier contracts
**Unconfirmed:** Which courier/delivery partners the business actually has (or will have) contracts with, their API/webhook formats, and SLAs — `12_Integrations.csv` lists "Couriers — Delivery — Webhook and proof" as unvalidated.
**Needed to resolve:** Signed courier partner contracts and their technical integration docs.
**Interim:** `LOG` module (shipments/tracking) is built against a generic carrier abstraction (`shipments.carrier_type`, `shipment_events.source`/`external_event_id`) so a specific courier's webhook shape plugs in later without a schema change. Own-fleet/manual dispatch is the fallback path until a courier contract exists. **Severity: MEDIUM.**

### 11. Warehouse insurance
**Unconfirmed:** Whether the marketplace operator's fulfillment center(s) are insured against stock loss/damage, and who bears liability for seller-consigned stock while it sits in platform-owned WMS.
**Needed to resolve:** Insurance policy procurement + legal terms defining liability split between platform and seller for FUL-module stock.
**Interim:** `FUL-007`/`BR-FUL-01` (seller ownership preserved across platform warehouse movements) is built regardless, since it's needed for correct accounting either way; no insurance-dependent business logic (e.g., auto-compensation on loss) is built until this is resolved. **Severity: HIGH.**

### 12. Product liability
**Unconfirmed:** Who is liable to the end customer for a defective/counterfeit product sold by a third-party seller — the seller, the platform, or both — and what evidence/dispute process this implies for `OPS-003` Dispute resolution.
**Needed to resolve:** Legal review + seller contract terms (TZ §06 SEL-004 "contract acceptance").
**Interim:** Dispute/return workflow captures evidence and decisions generically (`return_evidence`, `moderation_decisions`) without assuming which party is financially responsible; that allocation is a policy flag applied at decision time, not hardcoded. **Severity: HIGH.**

### 13. "Longrich" brand / trademark rights
**Unconfirmed:** Whether the business operating this marketplace holds the trademark/brand rights to use the name "Longrich" for a general multi-vendor marketplace (as opposed to Longrich's own direct-sales/MLM product line, which is a different commercial context).
**Needed to resolve:** Trademark search + written confirmation of rights (or a rename decision) from the project owner before any public-facing branding, domain, or app-store listing is created.
**Interim:** No branding, app-store listing, or public domain content ships under the "Longrich" name until this is confirmed; internal docs/tickets use "Longrich Marketplace" as a working project codename only, per TZ §01/§24. **Severity: HIGH.**

### 14. Authorization to use the `longrich.uzbekistan.uz` subdomain
**Unconfirmed:** Whether the project owner actually controls or has been granted the `uzbekistan.uz` subdomain delegation needed to stand up `longrich.uzbekistan.uz` (TZ §01: "longrich.uzbekistan.uz faqat subdomen boshqaruvi ruxsati bo'lsa ishlatiladi" — only if subdomain administration permission exists).
**Needed to resolve:** Written confirmation/delegation record from whoever administers `uzbekistan.uz`.
**Interim:** Dev/staging environments use a neutral placeholder domain; `longrich.uzbekistan.uz` is not referenced in code, DNS config, or deploy scripts until confirmed. **Severity: HIGH** (tied to #13).

### 15. Signed Click API docs / credentials
**Unconfirmed:** Current, partner-provided, signed Click API documentation and protocol version (Prepare/Complete or whichever variant Click assigns this merchant), plus live merchant credentials.
**Needed to resolve:** Obtain signed docs and sandbox+production credentials directly from Click (TZ §24: "Obtain current signed Click API docs from partner before production implementation"); do not rely on generic public API blog posts.
**Interim:** Click adapter is built to the `PaymentAdapter` interface (`createPayment`, `verifyCallback`, `getStatus`, `refund`) in mock/sandbox mode only; production Click integration is explicitly BLOCKED per TZ §36 until docs + credentials + signed callback contract are in hand. Credentials never go in prompts, chat, or committed files — environment secrets only (TZ §24/§25). **Severity: BLOCKER.**

### 16. Payme merchant credentials
**Unconfirmed:** Actual Payme Merchant API credentials and confirmed method support (CheckPerformTransaction/CreateTransaction/PerformTransaction/CancelTransaction/CheckTransaction/GetStatement) for this specific merchant account.
**Needed to resolve:** Payme merchant onboarding completed by the business owner; credentials handed off via secret manager, never via chat/docs (TZ §24: "No payment provider credentials should be placed in Claude prompts or Google Docs").
**Interim:** Same as Click — sandbox/mock adapter only, built against the documented Merchant API method shapes from `https://developer.help.paycom.uz/` and `https://docs.payme.uz/` (verification required before trusting these against the signed merchant contract), production path BLOCKED until credentials exist. **Severity: BLOCKER.**

---

## Secondary / implementation-process open question (not in TZ §24, flagged for completeness)

### 17. Requirement-ID drift between the blueprint prose and the spreadsheet
Not a business/legal fact — a documentation consistency issue. See `docs/traceability.md` → "Known conflict" section. Needs a short reconciliation ADR before G1, does not block G0. **Severity: UNRATED (process risk, not legal/business).** **Status as of G1 ticket-writing (2026-10-18): the reconciliation ADR still has not been written** — `tickets/g1/*.md` proceeded pragmatically on the existing canonical mapping rather than blocking on it; two more fold decisions from this pass are recorded in `docs/traceability.md`'s "G1 ticket mapping" note.

---

## Rule for all agents working this project

Per TZ §25/§26/§36: if you hit a business, legal, or external-integration fact not already resolved in this file, **add it here** rather than assuming an answer in code, copy, or config. Click/Payme adapters stay in sandbox/mock mode (per explicit TZ §25/§36 instruction, not an agent's own caution) until items #15/#16 are resolved. Production deployment and any destructive DB operation require explicit owner approval regardless of how "done" a milestone looks.

---

## Addendum (added by architect pass, G0 design — 2026-10-18)

### 18. SMS OTP delivery vendor
**Unconfirmed:** Which SMS gateway/aggregator the business has (or will have) a contract with for sending OTP codes to Uzbekistan phone numbers (e.g. Eskiz.uz, Play Mobile, or another local aggregator) — including short-code/sender-ID registration, delivery SLA, and per-message cost. TZ §02/§28 require "SMS OTP" throughout but, unlike Click/Payme, never name a candidate vendor or confirm one is contracted.
**Needed to resolve:** Vendor contract/account from the business owner; API credentials handed off via secret manager, never via chat/docs (same handling rule as Click/Payme, TZ §24/§25).
**Interim:** `docs/architecture/g0-design-notes.md` §1 defines OTP delivery behind a generic `SmsSenderAdapter` interface with a mock/log-to-console implementation for dev/CI, redacting the actual code even in the mock log line. Login/signup flow itself (challenge creation, hashing, TTL, rate limits, session issuance) is fully buildable and testable without a real SMS vendor. **Severity: HIGH** (not BLOCKER for G0 — the mock adapter unblocks all G0 engineering/CI; becomes BLOCKER before any staging/production rollout that must actually deliver an SMS to a real phone).

---

## Addendum 2 (added by PM pass, extensions TZ v2.4 reconciliation — 2026-10-18)

Source: `docs/source/longrich-tz-extensions-v2.4.txt` own "OPEN DECISIONS (DO NOT INVENT)" list (verbatim, line 13 of that file), expanded below in the same format as the rest of this file. These are new, extension-track-specific unknowns — do not resolve by inventing an answer in code, copy, or config. Items 15/16 (Click/Payme) and the new items 22/23/26 above are all tagged BLOCKER for a reason — they involve real money owed to or collected from a third party (ad billing, referral payouts, PVZ partner settlements) and guessing wrong has direct financial/legal exposure, not just a UX inconsistency. The CONFIRMED defaults section above is the opposite case: do not re-open items that are already settled just because a future ticket "feels like" it should double-check them.

### 19. PVZ closed-period extension/reroute rule
**Unconfirmed:** When a pickup point (PVZ) is closed/unavailable during an active parcel's pickup hold window (holiday, temporary closure, partner contract lapse), whether the 5-day/120h hold clock pauses or extends, whether the parcel auto-reroutes to another point, and who authorizes a reroute. EXT-010 itself flags this as still open ("closed-period handling policy still open").
**Needed to resolve:** Business/ops policy decision, informed by the partner-settlement legal model (#26 below) since a partner's closure affects their settlement too.
**Interim:** EXT-010's `pickup_expiration_policies` entity stays a configurable policy table, not a hardcoded rule; EXT-010 ships with only the single CONFIRMED default (flat 5-day/120h hold from the ready timestamp — see Confirmed Defaults below) and a closed PVZ simply blocks new checkout routing to it (already in EXT-010's own exception list) — in-flight-parcel rerouting stays a manual ops process until this is decided. **Severity: HIGH** (not a BLOCKER for starting EXT-010's core build, which only needs the open PVZ path).

### 20. Published reviews after a return
**Unconfirmed:** Whether a review stays publicly visible, unchanged, once the underlying order item is returned/refunded. EXT-004 states the rule "return does not automatically erase review" but does not say whether the review should be relabeled, flagged, or sent back through moderation once a return is recorded against the same order item.
**Needed to resolve:** Trust-and-safety / business policy decision on review integrity vs. disclosure of a later return.
**Interim:** EXT-004 ships with reviews surviving a return unchanged, exactly as the stated rule requires, and with no additional "returned" annotation/re-moderation logic built until this is decided. **Severity: MEDIUM.**

### 21. B2B quote renegotiation expiry reset
**Unconfirmed:** When a buyer counter-offers / renegotiates a commercial quote (EXT-021), whether the 7-day/168h validity clock resets from the renegotiation event or keeps counting down from the original issue time. EXT-021's own exception text defers this ("renegotiation creates version per policy pending").
**Needed to resolve:** B2B/commercial policy decision from sales ops.
**Interim:** `commercial_quotes` stays an immutable, versioned snapshot per quote revision so either rule can be applied retroactively without a schema change; EXT-021 ships with single-shot accept/reject/expire only — no renegotiation flow — until this is decided. **Severity: HIGH** (blocks only the renegotiation sub-flow, not the base RFQ → quote → accept path).

### 22. Paid ads pricing contract
**Unconfirmed:** The actual CPC/CPM/billing-model rate card offered to sellers for the ads cabinet (EXT-016) — minimum spend, currency/UZS rounding rules, any volume discounts.
**Needed to resolve:** Commercial/finance sign-off on the ads rate card.
**Interim:** EXT-016's `ad_spend_ledger` posts through the finance ledger generically, per the extensions doc's own global rule ("price/bonus/ad events connect to finance ledger, never arbitrary balance writes"); no specific CPC/CPM number is hardcoded anywhere until a rate card exists. **Severity: BLOCKER** for launching real ad billing; does **not** block building campaign CRUD/moderation/serving in mock/zero-cost mode.

### 23. Referral monetary treatment
**Unconfirmed:** Whether referral bonuses (EXT-017) are a cash-equivalent wallet balance, a discount-only credit, or a non-monetary loyalty point — this determines tax/accounting treatment and whether the stated rule "rewards not cash-out without legal review" ever changes. Directly entangled with Open Question #1 (merchant-of-record) and #4 (commission base) above.
**Needed to resolve:** Legal/finance review of bonus-as-currency implications.
**Interim:** `bonus_accounts`/`bonus_transactions` post through the finance ledger (never an arbitrary balance field written outside it), so whichever treatment is decided can be applied without re-architecting; a cash-out path is not built. **Severity: BLOCKER** (real financial/legal exposure if guessed wrong).

### 24. Historical archival retention exception
**Unconfirmed:** Whether price-history data (append-only, per `BR-CAT-04` and EXT-002) has any retention/deletion exception — e.g. a legal right-to-erasure request, or a storage-cost-driven archival-after-N-years policy — despite the stated "unlimited archive" default. Directly entangled with Open Question #9 (data residency/privacy) above.
**Needed to resolve:** Legal review of data-retention law as it interacts with an "append-only forever" design.
**Interim:** EXT-002 ships with unlimited retention per the CONFIRMED default (see below); any archival/erasure exception must not be silently implemented as a cost-saving measure before this is decided. **Severity: MEDIUM.**

### 25. Pricing anchor changes due to manual updates
**Unconfirmed:** When a seller manually overrides a price outside the automated repricing engine (EXT-019), whether that manual price immediately becomes the new ±10%/24h "anchored baseline," or whether the anchor only updates on the engine's own next scheduled run. This matters because EXT-019's own text explicitly warns the system "can't reset cap with micro-steps" — an anchor that resets on every manual edit would be exactly that loophole.
**Needed to resolve:** Product/pricing-policy decision on anchor-update triggers.
**Interim:** `repricing_guardrails` stays a configurable rule set; EXT-019 ships treating a manual price change as a flagged event requiring admin/guardrail review rather than a silent anchor reset, until this is decided. **Severity: MEDIUM.**

### 26. Partner settlements legal model
**Unconfirmed:** The legal/commercial structure for paying partner PVZ owners (EXT-010) — per-parcel fee, revenue share, or flat monthly fee — and which ledger entity records it. Same family of question as Open Question #1 (merchant-of-record) and #2 (PSP settlement) above, just for a different counterparty.
**Needed to resolve:** Commercial agreement with PVZ partners + finance sign-off.
**Interim:** `pvz_partner_settlements` exists as a generic entity (amount/period/status) without a hardcoded formula; no partner payout is disbursed until this is confirmed. **Severity: BLOCKER** (real money owed to a third party if guessed wrong).

---

## CONFIRMED defaults from extensions TZ v2.4 — settled, not open questions (added 2026-10-18)

These are the extensions doc's own "APPROVED DEFAULTS" list (line 10 of `docs/source/longrich-tz-extensions-v2.4.txt`, approved 2026-10-18). Unlike everything above, **these are decided business rules, not unknowns.** Do not re-litigate, re-ask the business owner, or treat as still-ambiguous in any future ticket, design doc, or code comment — treat them exactly as settled as the architecture decision in `ADR-001` is:

1. **Verified-purchase-only reviews** — a review (EXT-004) may only be submitted against a delivered order item the reviewer actually bought; no "anyone can review a product" path exists or should be built.
2. **90-day review submission window** — exactly `delivered_at + 90*24h` (UTC) from delivery; the 91st day blocks submission (EXT-004's own stated acceptance test).
3. **Append-only price history, unlimited retention by default** — `BR-CAT-04` + EXT-002: every price change is a new immutable row, never an update/delete; archival policy is "unlimited" unless Open Question #24 above changes that later.
4. **PVZ pickup hold = 5 days / 120 hours** from the `READY_FOR_PICKUP` timestamp (EXT-010) — this exact number is final; only the closed-period exception (Open Question #19) around it is still open.
5. **Automated repricing cap = ±10% cumulative within a rolling 24 hours, anchored to a baseline reference price** (EXT-019) — the cap itself and the 24h window are final; only how a *manual* price edit interacts with the anchor (Open Question #25) is still open.
6. **B2B commercial quote validity = 7 days / 168 hours from issue** (EXT-021) — this exact number is final; only whether a renegotiation resets this clock (Open Question #21) is still open.

Also confirmed as settled defaults, named in the same source line but not requiring a standalone numeric callout: **public offer prices + privacy-safe aggregated statistics only** (EXT-007 — never expose a competitor's actual cost/volume/profit), and **Longrich-owned + partner PVZs both in scope** (EXT-010 — not Longrich-only).

---

## Rule for all agents working this project (extensions track addendum)

Everything in "Addendum 2" above follows the same rule as the rest of this file: do not invent an answer to items 19–26 in code, copy, or config. Items 15/16 (Click/Payme) and the new items 22/23/26 above are all tagged BLOCKER for a reason — they involve real money owed to or collected from a third party (ad billing, referral payouts, PVZ partner settlements) and guessing wrong has direct financial/legal exposure, not just a UX inconsistency. The CONFIRMED defaults section above is the opposite case: do not re-open items that are already settled just because a future ticket "feels like" it should double-check them.

---

## Addendum 3 (added by PM pass, G1 Seller Onboarding & Portal ticket scoping — 2026-10-18)

New, milestone-specific unknowns hit while writing `tickets/g1/*.md`. Same rule as always: flagged here, not resolved by guessing in a ticket, code comment, or config default.

### 27. Malware-scan vendor for KYB document uploads
**Unconfirmed:** Which malware/AV scanning vendor or self-hosted engine (e.g. a managed cloud AV API, or a self-hosted ClamAV-style scanner) will inspect seller KYB documents before they are trusted — TZ §04/§28 require "malware scan" on sensitive file uploads but, like the SMS vendor (#18 above), never name a candidate or confirm a contract.
**Needed to resolve:** Vendor selection/contract (or an infra decision to self-host) from the business owner or architect; credentials (if any) via secret manager only, never chat/docs.
**Interim:** `T-G1-3` defines a generic `MalwareScanAdapter` interface (mirrors G0's `SmsSenderAdapter` swappable-provider pattern exactly) with a mock implementation that always reports "clean" for dev/CI, clearly logged as a mock. No document is trusted as a real malware-scan pass in any environment until a real adapter is wired in. **Severity: HIGH** (not a BLOCKER for building the KYB upload flow itself, same framing as #18; becomes BLOCKER before any KYB document is used to make a real approval decision on unscanned content in production).

### 28. Role authorized to suspend/reinstate a seller (SEL-009 / ADM-002)
**Unconfirmed:** TZ §02 names Moderator's scope as "seller/catalog approvals" and TZ §06/§29 say ACTIVE↔SUSPENDED "reinstatement controlled," but no TZ section names which admin role is actually authorized to suspend or reinstate an active seller — a materially different, arguably more sensitive action than approving a new application.
**Needed to resolve:** Business/security policy decision on which seeded admin role(s) should hold this permission.
**Interim — IMPLEMENTED in `T-G1-5` (2026-10-18):** The distinct `seller:suspend` permission (separate from `seller:moderate`, seeded `SUPER_ADMIN`-only per `T-G1-1`/`prisma/seed.ts`) now actually gates real endpoints: `POST /v1/sellers/{id}/suspend` and `POST /v1/sellers/{id}/reinstate` (`apps/api/src/modules/sellers/suspension/suspension.controller.ts` + `suspension.service.ts`, `PermissionGuard`/`@RequirePermission('seller:suspend')`). Verified end-to-end in `apps/api/test/seller-lifecycle-moderation-suspension.e2e-spec.ts`: `SUPER_ADMIN` gets 200, `MODERATOR` alone gets 403 (denial audit-logged). This resolves the *engineering* side of the question (narrowest-safe-default is live and tested); the *business* question of whether `SUPER_ADMIN`-only is the intended final policy is still open and reassignable later via `admin_role_permissions` with no code change. **Severity: MEDIUM** (narrow-by-default is a safe interim; only a problem if the real policy intends a broader grant and nobody revisits it).

### 29. APPROVED → ACTIVE transition trigger
**Unconfirmed:** TZ §06/§29 list the seller state pipeline as a straight arrow `...APPROVED→ACTIVE`, but never states whether `ACTIVE` is reached automatically the instant a reviewer approves, or requires a separate, possibly seller-initiated, step (e.g. first login, dashboard setup, accepting a final e-sign) between the two states.
**Needed to resolve:** Product decision on the exact seller-activation trigger.
**Interim — IMPLEMENTED in `T-G1-5` (2026-10-18):** `POST /v1/seller-applications/{id}/activate` (`apps/api/src/modules/sellers/moderation/moderation.controller.ts` + `moderation.service.ts`) is live as its own explicit, idempotent, separately-audited transition, gated by the same `seller:moderate` permission as the approval decision but requiring the application to already be `APPROVED` (409 `INVALID_STATE_TRANSITION` otherwise, including on a repeat activate of an already-`ACTIVE` seller). It flips only `sellers.status` (`seller_applications` has no `ACTIVE` value) and emits `seller.activated.v1`, recorded as a separate `audit_logs` row (`seller.activated`) from the `seller_application.approved` row the approval decision itself wrote — verified in `apps/api/test/seller-lifecycle-moderation-suspension.e2e-spec.ts` (asserts the two audit rows have distinct ids). This resolves the *engineering* side (either eventual product answer — automatic vs. seller-initiated — can be layered on top of this already-separate, already-audited step without a data migration); the *product* question of what should actually trigger this call (today: the same reviewer, manually) is still open. **Severity: MEDIUM.**

### 30. (Process/architecture, not legal) `OwnershipGuard` single-owner-id comparison vs. seller multi-member resolution
**RESOLVED during `T-G1-4` (2026-10-18).** Original framing: G0's `OwnershipGuard` (`apps/api/src/common/guards/ownership.guard.ts`) compares a single resolved `ownerId` against `request.user.id`, but a `seller_id`-scoped resource's real "owner" is a **set** of `seller_members` rows (OWNER/MANAGER/OPERATOR), not a single id.

**Decision:** Option A — `OwnershipGuard` itself is reused **completely unmodified**. The async `seller_members` lookup happens in a module-local access guard (`apps/api/src/modules/sellers/members/member-access.guard.ts`, the same shape `T-G1-2`/`T-G1-3` already established via `ApplicationAccessGuard`/`DocumentAccessGuard`), which attaches the caller's own full membership row (`callerMembership: SellerMember | null`, not just a boolean — richer than the application/document guards because `T-G1-4` also needs the caller's *role*, not just scope membership) onto `request.loadedResource`. The `OwnershipResolver` passed to `@RequireOwnership` is a pure, synchronous function that returns `request.user.id` when `callerMembership` is present, or `null` otherwise — exactly the pattern `resolveApplicationOwner`/`resolveDocumentOwner` already used, applied to the members resource for the first time end-to-end on a mutating (`PATCH`) route. `ownership.guard.spec.ts`'s existing fake-fixture test required **zero changes** — the guard's contract (one resolver, one id comparison) was never touched.

**A second, separate mechanism was added for role-gating (not ownership):** `SellerPermissionGuard` + `@RequireSellerPermission` (`apps/api/src/modules/sellers/members/seller-permission.guard.ts`), mirroring the *shape* of G0's `PermissionGuard`/`@RequirePermission` (metadata via `Reflector.getAllAndOverride`, 401-before-403, audit-on-deny) but resolving the caller's capability from `seller_members.role` via a small lookup table (`seller-permissions.ts`) instead of an `admin_role_permissions` grant. This is deliberately a *sibling* pattern, not an extension of `OwnershipGuard` itself — ownership answers "does the caller belong to this seller at all" (cross-seller IDOR), permission answers "does the caller's role allow this specific action" (privilege escalation); TZ §34 asks for both to be tested as distinct threats, so they are enforced as two distinct, independently testable guards (`@UseGuards(MemberAccessGuard, OwnershipGuard, SellerPermissionGuard)`).

**Severity: UNRATED (process risk, not legal/business) — resolved, not open.**

---

## Addendum 4 (added during G1 QA review fix round, 2026-10-18)

### 31. Bank account reference encryption-at-rest (SellerBankAccount, T-G1-8)
**Unconfirmed:** `seller_bank_accounts` stores the seller's bank reference as plaintext — there is no real encryption-at-rest (KMS, column-level crypto, or otherwise) today, only response-layer masking (`bank-accounts.mapper.ts`'s `maskBankReference`, which is correctly implemented and is NOT this gap). TZ §28 says bank information must be "encrypted/masked"; only the masking half is built.
**Needed to resolve:** A KMS/crypto design decision (which provider, key management, rotation policy) — out of scope for a QA bug-fix round; needs its own ticket/architecture decision.
**Interim — partially addressed during the G1 QA review fix round (2026-10-18):** QA flagged that the Prisma field/column was literally named `encryptedReference`/`encrypted_reference` despite holding plaintext — a misleading name that could cause a future developer to assume encryption-at-rest already exists. Renamed to `rawReference`/`raw_reference` via additive-safe migration `0007_seller_bank_account_raw_reference_rename` (plain column rename, no data loss, trivially reversible). This is a naming fix only — it does not add encryption. Real encryption-at-rest remains unbuilt and unscheduled until a KMS/crypto decision is made. **Severity: HIGH** (real bank-reference data at rest, currently mitigated only by response-layer masking + normal DB access controls, not by field-level encryption).

---

## Addendum 5 (added by PM pass, G2 Global Catalog & Offers ticket scoping — 2026-10-18)

New, milestone-specific unknown hit while writing `tickets/g2/*.md`. Same rule as always: flagged here, not resolved by guessing in a ticket, code comment, or config default.

### 32. MXIK/IKPU tax classification reference data source
**Unconfirmed:** TZ §07/§28 require storing an "MXIK reference classification version" against a product variant (`CAT-004`, canonical numbering — blueprint's own `CAT-006`), but no TZ section names the authoritative source for Uzbekistan's MXIK/IKPU code list: whether it is a government register with a public API, a static downloadable list requiring periodic re-import, or a commercial data vendor — nor how often that list is revised/versioned.
**Needed to resolve:** Confirmation from the business owner or a tax/compliance review of which MXIK/IKPU register is authoritative and how/whether it exposes a programmatic lookup.
**Interim:** `T-G2-4` stores an MXIK code plus an explicit `classification_version` string field on the identifier row, but builds no live lookup/validation integration against any external register — the code is accepted and stored as seller/admin-entered data, not verified against a real classification list, until this is resolved. No endpoint response in G2 claims the code has been validated. **Severity: HIGH** (not a BLOCKER for building the catalog data model itself — a nullable, versioned, unverified code column is sufficient for G2 — but becomes a real tax-compliance risk before any production classification decision relies on an unverified value).

---

## Rule for all agents working this project (catalog track addendum)

Same rule as every prior addendum: do not invent an answer to item 32 above in code, copy, config, or by hardcoding a guessed MXIK code list. A nullable, versioned, explicitly-unverified column is the correct G2-scope answer; a live validation integration is not built until the business owner names the authoritative source.

---

## Addendum 6 (added by PM pass, G7 buyer-web-catalog-slice ticket scoping — 2026-10-20)

New, milestone-slice-specific unknowns hit while writing `tickets/g7-buyer-web-catalog/*.md` (the buyer-facing web UI slice covering only home/category-browse/product-detail, scoped to G2's already-existing catalog/offers backend — not full G7). Same rule as always: flagged here, not resolved by guessing in a ticket, code comment, or config default.

### 33. Product/ProductVariant slug field for SEO-friendly URLs
**Unconfirmed:** `docs/source/longrich-design-system-v1.1.txt` DES-004 names the buyer product-detail route as `/product/[slug]`, but `prisma/schema.prisma`'s `Product`/`ProductVariant` models (confirmed by direct read, lines 691–748) have no `slug` column — only a UUID `id`. No ticket in G2 (`T-G2-1` through `T-G2-8`) added one. A real slug needs a uniqueness/collision policy (per-product? per-product+brand? frozen at creation, or re-derived on title edit — and if frozen, what happens to old links after a title edit?) that is a product/SEO decision, not an engineering guess.
**Needed to resolve:** Product/SEO decision on slug generation + uniqueness + edit-stability rule, then a backend ticket (new migration + backfill for existing rows) before any frontend route can use it.
**Interim:** `tickets/g7-buyer-web-catalog/T-G7C-5`'s product-detail page uses `/product/[id]` (the existing UUID) instead of inventing a slug scheme. DES-004's literal `/product/[slug]` stays deferred until this is resolved and a backend migration ships. **Severity: MEDIUM** (not a BLOCKER — UUID URLs work functionally today; becomes a real SEO/URL-stability concern before a production launch, per DES-019's "SEO SSR first content" bar).

### 34. No public seller/storefront profile endpoint
**Unconfirmed:** DES-004 names `/stores` and `/stores/[slug]` buyer routes, and `GET /v1/catalog/variants/{id}/offers` already exposes a bare `seller_id` per offer — but no G1 or G2 ticket built a public (no-auth) seller-profile read endpoint. Every route in `apps/api/src/modules/sellers/*.controller.ts` is gated behind `JwtAuthGuard` (confirmed by direct grep across the module), meaning there is no backend today that can answer "what is this seller's name/banner/rating" for an unauthenticated buyer.
**Needed to resolve:** A backend ticket (new public `GET /v1/sellers/{id}` or `/v1/stores/{slug}` endpoint, likely paired with a `slug` column on `sellers` too — same open question as #33, same team should decide both at once) — not scoped to G2, likely a short G7-prep backend addition.
**Interim:** `tickets/g7-buyer-web-catalog/` does not build a store directory or storefront page — the task brief for that ticket set included one only "if `GET /v1/catalog/.../offers` supports it cleanly," and it does not (seller_id only, no name/profile data). `docs/traceability.md`'s new G7-slice mapping note records this exclusion explicitly. **Severity: MEDIUM** (not a BLOCKER for this slice; becomes one before any `/stores` page can be built).

---

## Rule for all agents working this project (buyer-web-catalog-slice addendum)

Same rule as every prior addendum: do not invent a slug scheme or a seller-profile response shape to unblock `/product/[slug]` or `/stores` in code — ship against `/product/[id]` and skip the store directory, exactly as `tickets/g7-buyer-web-catalog/*.md` does, until items #33/#34 are resolved.
