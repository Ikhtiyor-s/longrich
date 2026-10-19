# mobile (Flutter — not scaffolded yet)

Buyer Android/iOS app, per `docs/architecture/repo-structure.md`.

This is a placeholder folder only — no `pubspec.yaml`, no Dart code, and (by
design) **not** a pnpm workspace member: Flutter's package ecosystem (`pub`)
is entirely separate from npm/pnpm, so this folder is never listed in
`pnpm-workspace.yaml`. It is built/tested via Flutter's own toolchain
(`flutter pub get` / `flutter analyze` / `flutter test`), wired into
`.github/workflows/ci.yml` as its own CI job that runs in parallel with the
pnpm/Turborepo job graph — Turborepo does not orchestrate it.

Per `docs/traceability.md`, this is G8 scope. Cross-stack contract sharing
with the backend does **not** go through `packages/shared-types` (Dart cannot
import TypeScript) — it goes through the generated OpenAPI spec
(`openapi.json`), consumed via `openapi_generator`/`swagger_dart_code_generator`
once this app is actually scaffolded.
