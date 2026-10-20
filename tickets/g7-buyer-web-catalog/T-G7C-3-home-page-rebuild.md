# T-G7C-3 — Home page (`/`) rebuilt on `@longrich/ui-kit`

**Requirement refs:** DES-003 (nav chrome), DES-005 (home composition: hero + 6 quick-access icons + category grid 6 cols desktop/2-3 mobile + product listings; "above-the-fold clearly show what the marketplace sells"; "hero promotional materials from real CMS; do not invent countdown/deal claim" — no CMS exists yet, so the hero stays static copy, no fabricated promo claims), DES-019. Data source: `GET /v1/catalog/categories`, `GET /v1/catalog/products`, `GET /v1/catalog/variants/{id}/offers`, exactly as already called in `apps/web-buyer/app/page.tsx` today — this ticket changes **how it renders**, not what it fetches. Milestone: this ticket set, see `T-G7C-1`'s scope-boundary note. Contributes toward `WEB-002`.

**Migration:** None.

## Goal

Replace `apps/web-buyer/app/home-client.tsx`'s inline-styled markup with `AppShell`/`Header`/`CategoryTile`/`ProductCard`/`Skeleton`/`EmptyState`/`ErrorPanel` from `@longrich/ui-kit`, preserving the DES-005 composition shape and the real server-side data wiring already in `page.tsx`, removing every inline `style={{}}` and the fake client-side substring search filter (superseded by `T-G7C-1`'s intentionally inert `SearchCombobox`).

## Files likely touched

- `apps/web-buyer/app/page.tsx` — keep as the server component doing the real `fetch()` calls; swap its ad-hoc local `interface` declarations for `@longrich/shared-types`'s `catalog.ts` types (from `T-G7C-2`)
- `apps/web-buyer/app/home-client.tsx` — rewritten on ui-kit components (or split into smaller client-component islands if that's a cleaner fit — frontend-dev's implementation call, not dictated here)
- `apps/web-buyer/app/__tests__/home-client.test.tsx` (new)
- `apps/web-buyer/package.json` — add `@longrich/ui-kit`/`@longrich/shared-types` as workspace deps (if not already linked) plus devDeps `jest`, `jest-environment-jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@types/jest`
- `apps/web-buyer/jest.config.js` (new, `next/jest` preset — handles CSS Modules natively, no `identity-obj-proxy` needed here unlike `packages/ui-kit`)
- `apps/web-buyer/app/globals.css` — trim only if a real duplication with ui-kit's own token usage is found; otherwise untouched

## How we'll know it's done

- Zero `style={{}}` usage anywhere in the home page's files (grep-verified) and no new hardcoded color/spacing value outside `globals.css`'s existing custom properties.
- Same real-data behavior as today: categories/products fetched server-side from the live API; loading state shown via `Skeleton` (today there is none — a blank flash); an empty category/product list renders `EmptyState`; **new behavior** — a fetch failure renders `ErrorPanel` instead of today's silent swallow-to-empty-array (`page.tsx`'s `getCategories`/`getProducts` currently `return []` on a non-OK response with no user-visible signal — this ticket fixes that).
- At least one RTL test renders `HomeClient` with fixture categories/products and asserts the category grid renders via `CategoryTile` and the product grid via `ProductCard`; a second test asserts the empty-category and empty-product cases each render `EmptyState`.
- `pnpm --filter @longrich/web-buyer test`, `lint`, `typecheck`, `build` all pass.

## Owner role

`frontend-dev`

## Depends on

T-G7C-1, T-G7C-2
