# T-G7C-4 — Category browse page (`/catalog/[categorySlug]`)

**Requirement refs:** DES-004 (route), DES-006 (catalog/category screen — desktop left facets 240–280px for category/brand/price/seller/rating/available/delivery/region/offer-type, top sorting, responsive 4–5 column grid; "do not invent result count"; "filter changes update URL"), DES-019. Milestone: this ticket set, see `T-G7C-1`'s scope-boundary note. Contributes toward `WEB-002`.

**Migration:** None.

## Scope note — which DES-006 facets are actually buildable now

`GET /v1/catalog/products` (per `docs/architecture/api-contract-g2.md`) supports only `cursor`, `limit`, `category_id` as query filters — there is no brand/price/seller/rating/delivery/region/offer-type filter and no sort parameter on the backend today. DES-006's full faceted-filter bar is **not** built in this ticket: only the one filter the API actually executes (`category_id`, driven by the route) is implemented. The page's filter UI must only ever show controls it can execute against the real API — no decorative/non-functional facet UI is added "for later."

## Goal

Build `/catalog/[categorySlug]`, resolving the category by slug against the already-fetched flat category list (no `GET /v1/catalog/categories/{slug}` endpoint exists — only by `{id}` — so slug→id resolution happens client/server-side against the list response, not via a dedicated endpoint), then listing that category's published products via `GET /v1/catalog/products?category_id=<id>`, rendered with `Breadcrumb` + a `ProductCard` grid + cursor-based "load more" + `Skeleton`/`EmptyState`/`ErrorPanel`.

## Files likely touched

- `apps/web-buyer/app/catalog/[categorySlug]/page.tsx` (new)
- `apps/web-buyer/app/catalog/[categorySlug]/category-client.tsx` (new)
- `apps/web-buyer/app/catalog/[categorySlug]/__tests__/category-client.test.tsx` (new)
- `packages/shared-types/src/catalog.ts` (reused from `T-G7C-2`, no new types expected)

## How we'll know it's done

- Visiting `/catalog/<real-slug>` renders that category's breadcrumb trail, built by walking `parent_id` client-side (the API returns a flat list, not a nested tree — `api-contract-g2.md` states explicitly that "nested taxonomy" describes the data model, not a server-response shape), and shows only that category's published products.
- An unknown slug renders `EmptyState`/not-found messaging — never a crash, and never an unfiltered "all products" fallback.
- The cursor-based "Yana yuklash" (load more) control fetches the next page via the response's `next_cursor`, and is disabled/hidden once `next_cursor` is `null`.
- No sort/brand/price/seller/rating/region filter control renders anywhere on this page in this ticket (see Scope note above) — a test asserts the filter UI contains only the category context, nothing else.
- At least one RTL test for: product grid render, empty-category state, and load-more cursor pagination behavior.
- `pnpm --filter @longrich/web-buyer test`, `lint`, `typecheck`, `build` all pass.

## Owner role

`frontend-dev`

## Depends on

T-G7C-1, T-G7C-2
