# T-G7C-1 — `@longrich/ui-kit` nav-chrome components + frontend test tooling setup

**Requirement refs:** DES-002 (design tokens — reuse `apps/web-buyer/app/globals.css`'s exact custom-property names, never reinvent a value), DES-003 (nav/app-chrome spec: desktop sticky top nav 64–80px height with brand/logo, catalog dropdown/link, central wide search, language selector, account/wishlist/cart icon group; mobile compact brand/search/scan/cart plus bottom nav Home/Categories/Scan-Search/Favorites/Profile with safe areas), DES-017 (component library: `AppShell`, `Header`, `MobileNav`, `SearchCombobox`, `Breadcrumb` — "typed, documented, tested and shared … business-specific variants, not copy/paste CSS per screen"), DES-019 (quality bar: default/hover/focus/active/disabled/loading/error/empty states where applicable; WCAG 2.2 AA; complete keyboard flows; visible focus indicators). Milestone: this ticket set (`tickets/g7-buyer-web-catalog/`), a deliberately narrow slice of full G7 — see `docs/traceability.md`'s new G7-slice mapping note under the Buyer Web table for the scope boundary. Contributes toward `WEB-002` (catalog navigation chrome only, not search/filters).

**Migration:** None — no backend/schema changes in this ticket set.

## Styling approach — FROZEN for every ticket in `tickets/g7-buyer-web-catalog/` (do not re-litigate per ticket)

**CSS Modules** (`*.module.css`, one file per component, colocated next to its `.tsx`). No inline `style={{...}}` objects anywhere, no new CSS-in-JS dependency, no Tailwind. Rationale: (1) zero new dependency — Next.js 15 (already in `apps/web-buyer/package.json`) supports CSS Modules natively; (2) scoped class names avoid the global-bleed risk of writing everything into `globals.css`; (3) idiomatic alongside the existing token file — every new `.module.css` reads colors/spacing/radii via `var(--token-name)` using the **exact** names already defined in `apps/web-buyer/app/globals.css` (`--canvas`, `--surface`, `--surface-alt`, `--text-primary`, `--text-secondary`, `--divider`, `--primary`, `--primary-hover`, `--primary-soft`, `--secondary`, `--success`, `--warning`, `--danger`, `--info`, `--space-1..8`, `--radius-card`, `--radius-input`, `--radius-button`, `--nav-height`, `--content-max`) — never a new hardcoded hex/px value. This replaces the ad-hoc `home-client.tsx` pattern (inline `style={{...}}` objects referencing the same tokens) with the same tokens, reusable typed components instead.

## Test tooling — new, first use in this repo's frontend packages (set up once here, reused by every other ticket)

- Add devDependencies to `packages/ui-kit/package.json`: `jest`, `jest-environment-jsdom`, `ts-jest`, `@testing-library/react`, `@testing-library/jest-dom`, `@types/jest`, `identity-obj-proxy` (mocks `*.module.css` imports to a class-name proxy under `ts-jest` — `packages/ui-kit` is a plain TS package consumed as source, not a Next.js app, so `next/jest`'s built-in CSS Modules handling is not available here).
- Add `packages/ui-kit/jest.config.js` (`ts-jest` preset, `testEnvironment: 'jsdom'`, `moduleNameMapper` for `\.module\.css$` → `identity-obj-proxy`, a `jest.setup.ts` importing `@testing-library/jest-dom`).
- Replace `packages/ui-kit/package.json`'s `"test": "echo ... no tests ... exit 0"` stub with a real `jest` invocation.
- `apps/web-buyer`'s own page-level test tooling (`next/jest`, which handles CSS Modules natively) is a **separate** setup, ticketed in `T-G7C-3` — not duplicated here.

## Goal

Build the four structural/nav-chrome components DES-017 names (`AppShell`, `Header`, `MobileNav`, `Breadcrumb`) plus `SearchCombobox`, as typed, CSS-Modules-styled, unit-tested `@longrich/ui-kit` exports, replacing the ad-hoc inline-styled `<header>` block in `apps/web-buyer/app/home-client.tsx` with reusable primitives every other ticket in this set consumes.

## Files likely touched

- `packages/ui-kit/package.json`, `packages/ui-kit/jest.config.js` (new), `packages/ui-kit/tsconfig.json` (test types)
- `packages/ui-kit/src/AppShell/{AppShell.tsx, AppShell.module.css, AppShell.test.tsx}`
- `packages/ui-kit/src/Header/{Header.tsx, Header.module.css, Header.test.tsx}`
- `packages/ui-kit/src/MobileNav/{MobileNav.tsx, MobileNav.module.css, MobileNav.test.tsx}`
- `packages/ui-kit/src/SearchCombobox/{SearchCombobox.tsx, SearchCombobox.module.css, SearchCombobox.test.tsx}`
- `packages/ui-kit/src/Breadcrumb/{Breadcrumb.tsx, Breadcrumb.module.css, Breadcrumb.test.tsx}`
- `packages/ui-kit/src/index.ts` — real export surface, replacing the current `PlaceholderShouldBeReplaced` G0 stub

## How we'll know it's done

- `pnpm --filter @longrich/ui-kit test` runs real RTL tests (not the current `echo` stub) and all pass.
- Each component ships the DES-019 states that apply to it in JS-testable form: `Header`/`SearchCombobox`/`MobileNav` have default/focus/disabled states covered by RTL assertions (hover/active are CSS-only, not required in a JS test); `AppShell`/`Breadcrumb` have default and empty (zero-crumb) states. Every component has at least one test asserting an accessible role/name (e.g. `role="navigation"`, `role="search"`, `aria-current="page"` on the active breadcrumb item).
- `SearchCombobox` is **explicitly non-functional** in this slice: it accepts controlled `value`/`onChange`/`onSubmit` props but ships **no default implementation that calls any API or filters any in-memory list** — there is no `q`/search query parameter on `GET /v1/catalog/products` per `docs/architecture/api-contract-g2.md` (only `cursor`, `limit`, `category_id`); full-text search stays a G7-backend-decision-pending item per `docs/traceability.md`'s own G2 status note. A test asserts that typing into the input triggers no fetch/filter side-effect on its own — a regression guard against reintroducing `home-client.tsx`'s fake client-only substring filter.
- `Header`/`MobileNav` render every DES-003 nav-chrome element (logo, catalog link, search slot, language indicator, account/wishlist/cart icon group), but every icon/link whose destination route is out of this ticket set's scope (cart, favorites, account, scan) renders `disabled`, `aria-disabled="true"`, with a visible "tez orada" label/tooltip — same user-facing behavior as the current ad-hoc `NavIconButton`, now a typed, tested, CSS-Modules component instead of a one-off inline-styled function.
- Zero `style={{...}}` inline objects in any file this ticket touches (grep-verifiable).
- Every new `.module.css` file references only existing `globals.css` custom properties for color/spacing/radius — no new hardcoded hex/px value (1–2px border widths excepted).
- `pnpm --filter @longrich/ui-kit lint` and `typecheck` pass.

## Owner role

`frontend-dev`

## Depends on

none
