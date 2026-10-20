# T-G7C-6 — Responsive + accessibility pass (WCAG 2.2 AA bar across home/category/product)

**Requirement refs:** DES-003 (breakpoints 320/360/375/390/768/1024/1366/1440/1920), DES-019 (WCAG 2.2 AA; semantic HTML; complete keyboard flows; visible focus indicators; contrast ≥4.5:1 normal text / ≥3:1 large text/UI indicators; color-blind-safe state labeling — never hue-only; no horizontal overflow except an intentional data grid; CLS avoidance on images), DES-020 (`DES-AC-002`/`DES-AC-003`/`DES-AC-015`/`DES-AC-016` — scoped to this slice's three pages only, not the full buyer site). Milestone: this ticket set, see `T-G7C-1`'s scope-boundary note. Contributes toward `WEB-006`.

**Migration:** None.

## Goal

Verify and fix, as its **own explicit pass** (not assumed to come free inside `T-G7C-3`/`T-G7C-4`/`T-G7C-5`), the DES-019 quality bar across every component and page this ticket set builds: responsive behavior at 320–1440px, full keyboard operability, visible focus rings, adequate contrast, and correct rendering of every loading/empty/error state at every breakpoint — not just desktop.

## Files likely touched

- Any file across `apps/web-buyer/app/{page.tsx,home-client.tsx,catalog,product}/**` and `packages/ui-kit/src/**/*.module.css` — responsive/focus-style fixes only, no new components
- `apps/web-buyer/package.json` / `packages/ui-kit/package.json` — add `jest-axe` (or `@axe-core/react`, frontend-dev's tooling call, flagged here so it is not silently skipped) as a devDependency
- New accessibility smoke test files alongside each page's existing `__tests__/` folder from `T-G7C-3/4/5`

## How we'll know it's done

- No horizontal overflow at 320px width on any of the three in-scope pages (home, category browse, product detail) — verified via an automated viewport check or manual DOM/screenshot review, recorded either way.
- An automated `jest-axe` (or equivalent) run against `AppShell` and each of the three pages returns zero serious/critical violations.
- Every interactive element across all three pages (Header icons, `SearchCombobox`, `CategoryTile` links, `ProductCard` add-to-cart/favorite controls, variant selector, tabs, load-more button) is reachable and operable via Tab/Shift+Tab/Enter/Space alone — at least one keyboard-only test per page confirms this.
- No `outline: none` (or equivalent focus-ring removal) in any `.module.css` without an explicit replacement focus style — grep-verified across every file this slice touches.
- Contrast of every text/background pairing used by a new component is checked against `globals.css`'s token values — this is a **verification** pass only; no new ad-hoc color is introduced here (that rule was already enforced in `T-G7C-1`/`T-G7C-2`).
- `pnpm --filter @longrich/web-buyer test` includes the new accessibility smoke tests and passes.

## Owner role

`frontend-dev`

## Depends on

T-G7C-3, T-G7C-4, T-G7C-5
