# T-G0-1 — Repo scaffold, monorepo structure, CI pipeline

**Requirement refs:** TZ §03 (ADR-001 system architecture — modular monolith, module boundaries), §04 (cross-cutting standards / Definition of Done), §20 (devops: GitHub Actions CI), §36 (Claude execution plan: "First inspect repository... create docs/traceability.md... work branch-by-branch"). Spreadsheet: `07_Architecture.csv` (stack table). Milestone: G0.

## Goal
Stand up the empty `D:\Docker\projects\longrich\` repo as a working monorepo skeleton (NestJS API + placeholder Next.js/Flutter app folders + shared packages) with lint/typecheck/test wired into a GitHub Actions CI pipeline that runs green on an empty-but-buildable codebase.

## Files likely touched
- `package.json`, `pnpm-workspace.yaml` (or chosen workspace tool) at repo root
- `apps/api/` — NestJS app skeleton (module boundary folders per TZ §03: identity, sellers, catalog, offers, pricing, inventory, cart, checkout, orders, payments, finance, logistics, fulfillment, returns, support, seo-cms, notifications, admin-audit — empty module stubs only, no business logic yet)
- `apps/web-buyer/`, `apps/web-seller/`, `apps/web-admin/`, `apps/web-warehouse/` — Next.js app placeholders (TZ §21: four distinct web apps)
- `apps/mobile/` — Flutter app placeholder (folder + README only, no code this ticket — G8 scope)
- `packages/shared-types/` — placeholder for cross-app DTO/type sharing
- `.github/workflows/ci.yml` — lint, typecheck, unit test, build steps
- `.eslintrc`, `.prettierrc`, `tsconfig.base.json`
- `README.md` (root) — states this is scaffold-only, links to `docs/traceability.md`

## How we'll know it's done
- Fresh clone + install + `pnpm build` (or equivalent) succeeds with zero app logic.
- CI pipeline runs on PR and on push to main; fails the build on lint/typecheck error (prove by intentionally breaking a rule in a throwaway branch and confirming red CI, then reverting).
- Module boundary folders exist under `apps/api/src/modules/*` matching TZ §03's module list exactly (no extra, no missing) — this is the structural contract later tickets build inside.
- No business logic, no DB connection, no secrets committed.

## Owner role
`architect`

## Depends on
none
