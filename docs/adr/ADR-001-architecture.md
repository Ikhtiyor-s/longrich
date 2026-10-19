# ADR-001: System Architecture — Modular Monolith with Transactional Outbox

**Status:** Accepted (architecture choice is not open for relitigation — see below)
**Date:** 2026-10-17
**Owner:** architect
**Source of truth:** `docs/source/longrich-tz-master-blueprint.txt` §03 (System Architecture / ADR-001), cross-checked against `docs/source/prd-spreadsheet/07_Architecture.csv`

## Context

Longrich Marketplace is a 3P multi-vendor marketplace (Uzum-Market scale) covering buyer web/mobile, seller portal, admin, and a self-operated WMS. TZ §03 already names this ADR "ADR-001" and states the decision inline; this document formalizes that decision as a proper ADR record rather than re-deciding it. Per the task brief: **this architecture is DECIDED, not the architect's choice to relitigate.** This ADR exists to make the decision traceable, explicit about consequences, and to pin the module boundary list that every G0+ ticket builds inside of.

The system must support: a single global product catalog with many seller offers per variant; one buyer cart/checkout spanning multiple sellers → one master order → per-seller sub-orders → shipments; an internal fulfillment/WMS operation; Click/Payme payment integration (sandboxed until credentials exist); double-entry seller ledger/commission/payout; returns/support/SEO/notifications; a Flutter buyer app sharing the same backend contract as the web buyer app.

## Decision

1. **Modular monolith**, implemented as a single NestJS/TypeScript application (`apps/api`), rather than microservices. Microservice extraction is explicitly deferred: "Migrate to microservices only with measured need" (TZ §03). No module is deployed or versioned independently in G0–G9.
2. **Transactional outbox + worker jobs** is the mechanism for all asynchronous, cross-module, and cross-service side effects. A business write and its corresponding domain event are committed in the *same* database transaction (the event row, in `platform.outbox_events`); a separate worker process drains that table and dispatches events. Consumers are idempotent via an inbox/dedup table (`platform.inbox_processed_events`).
3. **Presentation layer:** Next.js/TypeScript for four separately-permissioned web apps (buyer, seller, admin, warehouse); Flutter for buyer Android/iOS (mobile is G8 scope, not built now, but the contract this document's siblings freeze is written so it can consume it later without change).
4. **Data layer:** PostgreSQL as the single transactional store of record; Prisma for schema/migrations; Redis for caching, distributed locks, and BullMQ-backed job queues; OpenSearch for full-text/faceted search (resource-permitting, optional service profile in dev); S3/MinIO for object storage (signed URLs, malware scan on upload).
5. **Cross-cutting infra:** OpenTelemetry tracing, Prometheus metrics, Grafana dashboards, Loki log aggregation; GitHub Actions CI; Docker Compose for local development; production environments isolated with their own credentials, backups, and tested restore.
6. **No distributed ACID assumption.** Where a business process spans module boundaries or external providers (payment capture → ledger posting → stock commit, for example), the system uses compensating workflows and reconciliation jobs, not two-phase commit.
7. **Single source of truth per entity.** Search index documents and cached inventory-availability figures are *derived projections*, never the entity of record — they MUST be rebuildable from the owning module's transactional tables at any time without data loss.
8. **External integration credentials are referenced, never stored in plaintext.** Any table holding provider configuration (e.g. a future `payment_provider_configs`) stores a `secret_reference` pointing at a secret manager/environment variable, never the secret value itself.

### Module boundary list (frozen for G0; this is the folder-structure contract downstream tickets build inside)

Per TZ §03, the modular monolith has exactly these 18 module boundaries:

| # | Module | Primary concern |
|---|---|---|
| 1 | `identity` | users, OTP auth, sessions/refresh tokens, admin RBAC catalog |
| 2 | `sellers` | seller onboarding/KYB, seller profile, staff (G1) |
| 3 | `catalog` | categories, products, variants, identifiers, media (G2) |
| 4 | `offers` | seller offers, price history (G2) |
| 5 | `pricing` | pricing rules, promo application (introduced when checkout needs it) |
| 6 | `inventory` | warehouses, stock items, reservations, adjustments (G3) |
| 7 | `cart` | cart/cart items (G4) |
| 8 | `checkout` | quote, checkout session (G4) |
| 9 | `orders` | master orders, sub-orders, order items, status history (G4) |
| 10 | `payments` | payment intents/transactions, Click/Payme adapters (G5, sandbox only) |
| 11 | `finance` | commission, ledger, settlements, payouts (G5) |
| 12 | `logistics` | delivery zones/tariffs, shipments, tracking (G6) |
| 13 | `fulfillment` | fulfillment centers, WMS bin/lot/pick/pack (G3 receiving, G6 pick/pack) |
| 14 | `returns` | RMA, refunds (G5) |
| 15 | `support` | tickets, messages, SLA (G7) |
| 16 | `seo-cms` | SEO metadata, redirects, CMS pages/banners (G7) |
| 17 | `notifications` | templates, preferences, delivery attempts, device tokens (G7/G9) |
| 18 | `admin-audit` | admin roles/permissions/members, moderation cases, immutable audit log |

No module is added or removed in G0; only `identity` and `admin-audit` get real tables/code this milestone (per T-G0-3/4/5/6). The other 16 exist as empty stub folders per T-G0-1's acceptance criteria — this is a structural placeholder, not an invitation to start G1+ business logic early.

### Cross-module write rule (binding on all future code, not just G0)

- A module MUST NOT read or write another module's Prisma models directly, and MUST NOT issue a raw SQL query that joins across tables owned by a different module. There is no "just this once" exception for convenience joins.
- A module MAY depend on another module's exported **application-service interface** (a NestJS provider exported from that module and injected via DI) for **synchronous, same-transaction** needs — e.g. `checkout` module calling `InventoryService.reserve(...)` as part of building one master order, inside one request's transaction boundary.
- Any **asynchronous / eventually-consistent** cross-module side effect MUST go through the transactional outbox → worker → inbox-dedup path, using a versioned event name (`payment.succeeded.v1`, `inventory.reserved.v1`, `order.created.v1`, `shipment.delivered.v1`, `refund.completed.v1`, and future versioned names as modules land). A module MUST NOT call another module's write method directly just to propagate a side effect that isn't needed for the current transaction's own correctness.
- Rule of thumb: if module A's correctness *within this request* depends on module B's data right now, that's a synchronous DI call. If module A is just *telling the rest of the system something happened*, that's an outbox event.

## Consequences

**Positive:**
- One deployable unit, one database connection pool, one CI pipeline, one place to reason about a request's full call stack — appropriate for a team building 18 modules concurrently without the coordination overhead of 18 separately-deployed services.
- Strong transactional consistency is available for free within a module (and across modules via synchronous DI calls) using native Postgres transactions — no premature distributed-systems complexity for invariants like "available = on_hand − reserved − blocked ≥ 0" (TZ §08) which need a real row lock, not eventual consistency.
- The outbox/inbox pattern gives at-least-once delivery + effectively-once processing for cross-module side effects without requiring a message broker (Kafka, RabbitMQ) in G0–G9; Redis/BullMQ is sufits for this scale per TZ §03's named stack.

**Negative / accepted tradeoffs:**
- A bug or resource leak in one module's code can affect the availability of the whole system (no process-level isolation between modules) — mitigated operationally by health/readiness checks, OpenTelemetry tracing to localize faults fast, and by keeping the worker process (background job draining) as a *separate* OS process/container from the HTTP API (see `docs/architecture/repo-structure.md`) so a stuck worker job doesn't block HTTP request handling.
- Module boundaries are enforced by code review discipline and (recommended, not yet implemented in G0) lint rules / dependency-graph checks, not by hard process/network boundaries. This is a conscious bet that is cheaper to re-litigate later ("migrate to microservices only with measured need") than to over-engineer now.
- The outbox table is a single point of serialization for all async events; at this scale it is not expected to be a bottleneck, but the worker design (`docs/architecture/g0-design-notes.md`) uses `FOR UPDATE SKIP LOCKED` batched claims specifically so it can scale to multiple worker replicas later without a redesign.

## Out of scope for this ADR

- Choosing *which* modules get their own Postgres schema beyond the two TZ §30 explicitly names (`platform`, `commerce`) — see `prisma/schema.prisma` for the G0 schema placement decision (identity/RBAC/audit in `public`). Any later module requesting its own schema (e.g. `finance`) is a decision for that module's own architect pass, not decided here.
- Naming/versioning scheme for event payloads beyond the five example event names TZ §03 lists. Each module's own design pass defines its own event payload shapes when it's built.
- Whether to eventually split the monolith — explicitly deferred per TZ §03's own wording; not re-opened by this ADR.
