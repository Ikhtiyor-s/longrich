# web-admin (not scaffolded yet)

Admin web app, per `docs/architecture/repo-structure.md`.

This is a placeholder folder only — no `package.json`, no pnpm workspace
membership, no code. It is scaffolded (mirroring `apps/web-buyer`'s Next.js
setup) once its first real screen is needed. Per `docs/traceability.md`, admin
RBAC/audit backend lands in G0 (`T-G0-3`/`T-G0-5`/`T-G0-6`), but this app's own
UI is full-build scope in G7.

See TZ §21 for the screen inventory this app will eventually cover (overview,
seller KYB queues, seller detail, catalog moderation, product merge review,
orders monitor, payments reconciliation, ledger/settlements,
delivery/WMS monitoring, support, SEO CMS, feature flags, users/roles, audit).
