# T-G0-2 — Docker Compose dev environment

**Requirement refs:** TZ §03 (PostgreSQL primary store, Redis, OpenSearch, S3/MinIO, reverse proxy, OTel/Prometheus/Grafana/Loki), §20 ("Docker Compose for dev with PostgreSQL, Redis, MinIO, OpenSearch (when resource permitting), API, workers and UIs"). Spreadsheet: `07_Architecture.csv`. Milestone: G0.

## Goal
Provide a single `docker-compose.dev.yml` that brings up every infra dependency the project needs locally (Postgres, Redis, MinIO, OpenSearch optional/flagged, API container, worker container placeholder) with one command, matching the stack table in TZ §03/`07_Architecture.csv`.

## Files likely touched
- `docker-compose.dev.yml` (repo root)
- `infra/docker/api.Dockerfile`, `infra/docker/worker.Dockerfile`
- `.env.example` (no real secrets — placeholders only, per TZ §20 "secrets stored in dedicated manager... not source control")
- `infra/docker/postgres/init.sql` (if needed for extensions, e.g. `uuid-ossp`/`pgcrypto`)
- `Makefile` or `package.json` scripts for `dev:up` / `dev:down` / `dev:logs`

## How we'll know it's done
- `docker compose -f docker-compose.dev.yml up` starts Postgres, Redis, MinIO, and the API container (OpenSearch may be toggled behind a profile flag per "when resource permitting") with healthy health-checks on all services.
- API container can reach Postgres and Redis by service name (prove with a trivial connectivity check endpoint, not business logic).
- No credential is hardcoded in the compose file itself — all pulled from `.env` (gitignored), with `.env.example` committed showing required keys only.
- Teardown (`dev:down`) removes containers without destroying named volumes unless explicitly requested (so local data persists across restarts).

## Owner role
`backend-dev`

## Depends on
T-G0-1
