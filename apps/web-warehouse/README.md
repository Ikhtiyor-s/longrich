# web-warehouse (not scaffolded yet)

Warehouse/WMS web app, per `docs/architecture/repo-structure.md`.

This is a placeholder folder only — no `package.json`, no pnpm workspace
membership, no code. It is scaffolded (mirroring `apps/web-buyer`'s Next.js
setup) once its first real screen is needed. Per `docs/traceability.md`, WMS
receiving backend lands in G3, pick/pack in G6; this app's own UI is full-build
scope in G7.

See TZ §21 for the screen inventory this app will eventually cover (inbound
appointment list, receiving barcode scan, QC, putaway, bin map, picking queue,
packing station, dispatch manifest, stocktakes, returns intake).
