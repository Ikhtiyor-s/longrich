# @longrich/shared-types

Cross-app DTO/type definitions shared by `apps/api` and the four Next.js web apps
(`web-buyer`, `web-seller`, `web-admin`, `web-warehouse`), per
`docs/architecture/repo-structure.md`.

G0 scaffold only — empty placeholder. Real types are added alongside the backend
module/ticket that first needs to share a shape with a frontend (see
`docs/traceability.md` for milestone assignment). Not consumed by `apps/mobile`
(Flutter) — the mobile app's cross-stack contract is the generated OpenAPI spec,
not this package.
