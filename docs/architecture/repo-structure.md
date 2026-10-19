# Repo / Monorepo Structure Decision

**Status:** Frozen for G0. Changes to top-level layout after T-G0-1 ships go through the architect + a documented reason, same as the API contract.
**Depends on:** `docs/adr/ADR-001-architecture.md`

## Workspace tool decision

**Package manager: pnpm. Task runner / workspace orchestration: Turborepo.**

### Why pnpm
- It's the tool T-G0-1 already names as the default assumption (`pnpm-workspace.yaml (or chosen workspace tool)`) — no reason to deviate without justification, and there isn't one here.
- Content-addressable store: the repo will have five TypeScript apps (`api`, `web-buyer`, `web-seller`, `web-admin`, `web-warehouse`) that share most of their `devDependencies` (TypeScript, ESLint, Prettier) and a meaningful chunk of runtime deps (React/Next.js across the four web apps). pnpm avoids four to five copies of the same packages on disk and in CI cache.
- Strict `node_modules` (no phantom dependencies): valuable given 18 NestJS module boundaries inside one app — it keeps a module from accidentally resolving a transitive dependency it never declared, which otherwise becomes a silent coupling between modules that violates ADR-001's boundary rule.
- Native `workspace:*` protocol for `packages/*` consumed by `apps/api` and the four Next.js apps.

### Why Turborepo, not Nx
Both are legitimate choices for this stack; Turborepo is picked because:
- **Lower adoption cost for a greenfield repo.** Turborepo needs one `turbo.json` task-pipeline file and otherwise reads each app's own `package.json` scripts (`build`, `lint`, `test`, `typecheck`) as-is. Nx asks every package to adopt its `project.json`/plugin/executor model, which is more power than G0 needs and more surface area for a team of agents to get wrong early.
- **The features that justify Nx (generators, a plugin ecosystem, distributed task execution across machines) aren't needed yet.** What *is* needed — "don't rebuild/retest apps that didn't change," and a shared remote build cache as the number of workspace packages grows from G0 through G9 — is exactly Turborepo's core feature set, with less config.
- **Reversible decision.** Nothing in the module-boundary or folder-layout decisions below is Turborepo-specific; moving to Nx later, if a real need shows up (e.g. needing affected-graph-aware codegen), would not require re-architecting the monorepo, only replacing the task-runner config.

### Why Flutter cannot and does not join this workspace
Flutter's package ecosystem (`pub`, `pubspec.yaml`/`pubspec.lock`) is entirely separate from npm/pnpm; there is no meaningful way to put a Flutter app inside a `pnpm-workspace.yaml` `packages:` glob. Decision:
- `apps/mobile/` is a plain sibling folder under `apps/`, with its own `pubspec.yaml`. It is **not** listed in `pnpm-workspace.yaml`.
- It is built/tested via Flutter's own toolchain (`flutter pub get`, `flutter test`, `flutter build`), wired into `.github/workflows/ci.yml` as a **separate CI job** (`subosito/flutter-action`) that runs in parallel with the pnpm/Turborepo job graph — Turborepo does not orchestrate it and never will.
- Cross-stack contract sharing with Flutter does **not** go through `packages/shared-types` (Dart cannot import TypeScript). It goes through the generated OpenAPI spec (TZ §19: "OpenAPI generated from DTOs and contract-tested") — Flutter runs its own `openapi_generator`/`swagger_dart_code_generator` step against the published `openapi.json` as its build step, consuming the exact same frozen contract this document's sibling (`api-contract-g0.md`) defines, with zero JS/TS dependency.
- This is mechanically a G8 concern (mobile isn't built yet), but the decision is recorded now because it affects how `packages/shared-types` is scoped (web-only, see below) and because T-G0-1 creates the `apps/mobile/` placeholder this milestone.

## Top-level layout

```
longrich/
├── apps/
│   ├── api/                         # NestJS modular monolith (ADR-001)
│   │   ├── src/
│   │   │   ├── modules/             # 18 module boundaries, one folder each (see mapping below)
│   │   │   │   ├── identity/
│   │   │   │   ├── sellers/
│   │   │   │   ├── catalog/
│   │   │   │   ├── offers/
│   │   │   │   ├── pricing/
│   │   │   │   ├── inventory/
│   │   │   │   ├── cart/
│   │   │   │   ├── checkout/
│   │   │   │   ├── orders/
│   │   │   │   ├── payments/
│   │   │   │   ├── finance/
│   │   │   │   ├── logistics/
│   │   │   │   ├── fulfillment/
│   │   │   │   ├── returns/
│   │   │   │   ├── support/
│   │   │   │   ├── seo-cms/
│   │   │   │   ├── notifications/
│   │   │   │   └── admin-audit/
│   │   │   ├── common/              # cross-cutting, framework-level (see below)
│   │   │   │   ├── guards/
│   │   │   │   ├── decorators/
│   │   │   │   ├── interceptors/
│   │   │   │   ├── filters/
│   │   │   │   ├── telemetry/
│   │   │   │   ├── audit/           # owns audit_logs — see note below
│   │   │   │   ├── outbox/          # owns platform.outbox_events
│   │   │   │   ├── idempotency/     # owns commerce.idempotency_keys
│   │   │   │   └── inbox/           # owns platform.inbox_processed_events
│   │   │   ├── main.ts              # HTTP entrypoint
│   │   │   ├── worker.main.ts       # BullMQ worker entrypoint (no HTTP listener) — see note below
│   │   │   └── app.module.ts
│   │   └── test/
│   ├── web-buyer/                   # Next.js
│   ├── web-seller/                  # Next.js
│   ├── web-admin/                   # Next.js
│   ├── web-warehouse/               # Next.js
│   └── mobile/                      # Flutter — not a pnpm workspace member, see above
├── packages/
│   ├── shared-types/                # DTOs / request-response shapes shared by api + the 4 web apps
│   ├── ui-kit/                      # shared React primitives (not final visual design — TZ §21: no 1:1 Uzum copy)
│   └── config/                      # shared eslint/tsconfig/prettier base configs
├── prisma/
│   ├── schema.prisma                # single schema, see note below
│   ├── migrations/
│   └── seed.ts
├── infra/
│   └── docker/                      # api.Dockerfile, worker.Dockerfile, postgres/init.sql (T-G0-2 scope)
├── docs/
│   ├── adr/
│   ├── architecture/
│   └── source/
├── tickets/
├── .github/workflows/ci.yml
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### Why `prisma/` lives at the repo root, not inside `apps/api/`
T-G0-3's own "Files likely touched" list already names `prisma/schema.prisma` and `prisma/migrations/...` at the repo root (not `apps/api/prisma/...`); this document aligns with that rather than introducing a different path. Practically, a root-level `prisma/` is also the right call because:
- Both `apps/api` (HTTP) and the worker process (same package, different entrypoint — see below) need the same generated Prisma client; a single root schema avoids either duplicating it or building an awkward cross-app relative import.
- It is the one piece of "data layer" that is genuinely shared infrastructure, not owned by one module or one app — consistent with ADR-001's module-boundary rule being about *business* modules, not about where the DB client itself lives.

### Why there is one `apps/api` package, not a separate `apps/worker`
T-G0-2 asks for a `worker.Dockerfile` and a "worker container placeholder," which could be read as "a separate app." Decision: it is **the same NestJS codebase**, with two bootstrap files — `src/main.ts` (HTTP, Nest's standard `NestFactory.create`) and `src/worker.main.ts` (no HTTP adapter; boots the same `AppModule`'s providers, but only starts the BullMQ processors — e.g. the outbox-dispatcher job from `common/outbox/`). `infra/docker/worker.Dockerfile` builds the same `apps/api` output and simply points its `CMD`/entrypoint at `worker.main.ts` instead of `main.ts`.
Rationale: ADR-001 frames the worker as the monolith's background-processing *mode*, not a separate service with its own deploy lifecycle or its own copy of all 18 modules' code. Splitting it into a second top-level app would duplicate the module-boundary structure for no benefit at G0–G9 scale and would reintroduce exactly the cross-service-contract problem ADR-001 is trying to avoid by staying a monolith.

### Why cross-cutting *data-owning* infra (`audit`, `outbox`, `idempotency`, `inbox`) lives under `common/`, not a third top-level concept
T-G0-6 already specifies `apps/api/src/common/audit/audit.service.ts` as its file path. Rather than introduce a `platform/` top-level folder (which would be the more textbook separation — "common" for stateless utilities, "platform" for things that own a schema) and contradict an already-written ticket's path, this document extends the ticket's own convention: `common/` holds both pure framework utilities (guards, interceptors, telemetry setup — no owned schema) **and** the small number of cross-cutting services that do own a Prisma model but are consumed by every module (`audit`, `outbox`, `idempotency`, `inbox`). This is a deliberate consistency choice with the frozen ticket paths, not an oversight — call sites elsewhere in this document and in `g0-design-notes.md` assume this layout.

## NestJS module boundary → folder mapping (G0 state)

Every module in ADR-001's list gets a stub folder per T-G0-1's acceptance criteria (`apps/api/src/modules/<name>/`), each exporting an (initially empty) `*.module.ts`. In G0, only two get real content:

- `modules/identity/` — `users`, `otp_challenges`, `sessions`, `refresh_tokens` Prisma models; `auth.controller.ts`, `auth.service.ts`, `otp.service.ts`, `session.service.ts` (T-G0-4).
- `modules/admin-audit/` — `admin_roles`, `admin_permissions`, `admin_role_permissions`, `admin_members` Prisma models and their domain services (T-G0-3/T-G0-5's permission/role lookups live here; the *mechanism* — the guard itself — lives in `common/guards/` per the ticket's own path, consistent with the note above).

The other 16 module folders are empty stubs with no Prisma models and no business logic in G0 — creating logic inside them before their milestone (per `docs/traceability.md`'s milestone column) is out of scope and should be flagged in code review, not silently allowed because "the folder already exists."

## CI shape (described here; the actual `.github/workflows/ci.yml` is T-G0-1's deliverable to write, not this document's)

- One job for the pnpm/Turborepo graph: install (pnpm, frozen lockfile) → `turbo run lint typecheck test build` (Turborepo will skip unaffected packages on PRs once caching is configured; G0 can start without remote cache and add it later without a config shape change).
- One separate job for Flutter: `flutter pub get` → `flutter analyze` → `flutter test`, gated only on `apps/mobile/**` changes once that path exists (G8); in G0 this job can be a no-op placeholder that passes trivially on the empty scaffold, per T-G0-1's "no app logic" acceptance bar.
- A follow-up grep-based secret/PII leakage check (T-G0-6 mentions this explicitly for log output) runs as its own CI step, not folded into the unit test job, so it's easy to see fail on its own.
