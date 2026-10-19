# Longrich Marketplace

Status: **G0 scaffold.** This milestone stands up the monorepo skeleton, CI
pipeline and module-boundary structure only — there is no business logic, no
database connection at runtime, and no secrets committed. See
`docs/traceability.md` for what is and isn't implemented, and
`tickets/g0/` for the ticket that produced this state.

## Source of truth

- `docs/source/longrich-tz-master-blueprint.txt` — the master requirements document (authoritative on conflict).
- `docs/source/longrich-tz-extensions-v2.4.txt` — R1–R4 / EXT-001..022 feature extensions, additive on top of the master blueprint, approved 2026-10-18.
- `docs/source/longrich-design-system-v1.1.txt` — Design System & UX/UI specification addendum (DES-001..021, DES-AC-001..020), approved direction 2026-10-18. Additive: does not change business rules, schema or API contracts already frozen by the documents above — informs G7 web UI work (and any UI-adjacent scaffolding earlier milestones touch) once their data dependencies exist.
- `docs/adr/ADR-001-architecture.md` — system architecture decision (modular monolith, module boundaries — frozen).
- `docs/architecture/repo-structure.md` — workspace tool + folder layout decision (frozen).
- `docs/architecture/api-contract-g0.md` — frozen G0 API contract.
- `docs/architecture/g0-design-notes.md` — implementation detail behind the frozen contract/schema.
- `docs/traceability.md` — requirement ID → milestone → status tracking.
- `docs/open-questions.md` — unresolved business/legal/external-integration facts. Never guess an answer here; add a new entry instead.
- `prisma/schema.prisma` — the single Prisma schema (root-level; see `repo-structure.md` for why).

## Stack

pnpm workspaces + Turborepo. NestJS (`apps/api`, modular monolith per ADR-001).
Next.js for buyer/seller/admin/warehouse web apps. Flutter for the mobile app
(outside the pnpm workspace — see `docs/architecture/repo-structure.md`).
PostgreSQL via Prisma. See `docs/adr/ADR-001-architecture.md` for the full
stack decision.

## Repository layout

```
apps/
├── api/            NestJS modular monolith — 18 module-boundary stub folders (ADR-001)
├── web-buyer/      Next.js, scaffolded this milestone
├── web-seller/     placeholder (README only) — scaffolded when first needed
├── web-admin/      placeholder (README only) — scaffolded when first needed
├── web-warehouse/  placeholder (README only) — scaffolded when first needed
└── mobile/         placeholder (README only), Flutter, G8 scope, outside pnpm workspace
packages/
├── config/         shared eslint/tsconfig/prettier base configs
├── shared-types/   cross-app DTOs shared by apps/api + the Next.js apps (placeholder)
└── ui-kit/         shared React primitives (placeholder)
prisma/             single schema/migrations/seed, shared by apps/api's HTTP + worker entrypoints
docs/                architecture, ADRs, traceability, open questions
tickets/             per-milestone ticket files
```

## Running locally

Requires Node 24 (`.nvmrc`) and pnpm 9 (`packageManager` field — `corepack enable` will pick it up).

```sh
pnpm install
pnpm db:generate     # prisma generate — no DB connection required
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Per-app dev servers:

```sh
pnpm --filter @longrich/api start:dev
pnpm --filter @longrich/web-buyer dev
```

Database migrations (`DATABASE_URL` required — copy `.env.example` to `.env`
and point it at a running Postgres instance, e.g. the one started below):

```sh
pnpm db:migrate:dev
pnpm db:migrate:deploy
```

## Local dev environment (Docker Compose, T-G0-2)

`docker-compose.dev.yml` brings up every infra dependency the project needs
locally: Postgres, Redis, MinIO, a one-shot migration runner, the API
container and a worker container. OpenSearch is behind a Compose **profile**
(`search`) per TZ §03/§20's "when resource permitting" wording — it is not
started by the default command below.

```sh
cp .env.example .env     # first time only; edit if you changed a default port

pnpm dev:up               # docker compose -f docker-compose.dev.yml up -d --build
pnpm dev:logs              # follow logs for all services
pnpm dev:down              # stop containers; named volumes (data) are kept

# OpenSearch is optional — start it explicitly when needed:
docker compose -f docker-compose.dev.yml --profile search up -d opensearch
```

| Service            | Host port                  | Notes                                                                                                                                                  |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postgres`         | 5432                       | `postgres:16-alpine`, healthcheck via `pg_isready`                                                                                                     |
| `redis`            | 6379                       | `redis:7-alpine`, healthcheck via `redis-cli ping`                                                                                                     |
| `minio`            | 9000 (API), 9001 (console) | `bitnamilegacy/minio` — see note below; bucket from `MINIO_BUCKET` is auto-created via `MINIO_DEFAULT_BUCKETS`                                         |
| `opensearch`       | 9200                       | `opensearchproject/opensearch:2`, profile `search`, not started by default                                                                             |
| `migration-runner` | —                          | one-shot, runs `pnpm db:migrate:deploy`; `api`/`worker` wait on `service_completed_successfully`                                                       |
| `api`              | 3000 (or `API_PORT`)       | built from `infra/docker/api.Dockerfile`; `GET /health` (liveness) and `GET /health/ready` (checks Postgres + Redis by service name)                   |
| `worker`           | —                          | built from `infra/docker/worker.Dockerfile`, same codebase as `api`, different entrypoint (`worker.main.ts`); no BullMQ processors registered yet (G0) |

All credentials are read from `.env` (gitignored) via `.env.example`'s
placeholders — nothing is hardcoded in the compose file itself. Named volumes
(`postgres_data`, `redis_data`, `minio_data`, `opensearch_data`) persist across
`pnpm dev:down` / `pnpm dev:up` cycles; use `docker compose -f
docker-compose.dev.yml down -v` to also drop them.

**MinIO image substitution note.** The official `minio/minio` and `minio/mc`
Docker Hub images now require an authenticated pull (MinIO's 2025 licensing
change gated the AGPLv3 community images behind a login). This repo uses
`bitnamilegacy/minio` instead — same upstream MinIO server, still pullable
anonymously. If/when the team has credentials for MinIO's own registry, this
is a one-line `image:` swap in `docker-compose.dev.yml`, not a design change.

**No `prisma/migrations/*.sql` are added by this ticket.** `migration-runner`
runs `pnpm db:migrate:deploy`, which today reports "No pending migrations to
apply" and only creates Prisma's own empty bookkeeping table — T-G0-3 owns the
actual migration history.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every PR:
install → prisma generate → lint → typecheck → test → build (pnpm/Turborepo),
plus a separate secret/PII-leakage grep check and a separate Flutter job
(no-op until `apps/mobile` is scaffolded in G8).
