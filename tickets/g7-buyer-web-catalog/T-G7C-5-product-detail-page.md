# T-G7C-5 — Product detail page (`/product/[id]`)

**Requirement refs:** DES-004 (route — **adapted**, see Open question below), DES-007 (product detail: gallery, header/title/category/brand, selected-variant attributes, seller-offer selector with true price/stock/delivery per seller — "a seller offer is not a duplicate global product"; tabs Tavsif/Xususiyatlar/Narx tarixi/Do'konlar/Savol-javob/Sharhlar — only Tavsif/Xususiyatlar/Do'konlar are in scope here, see Scope note; "invalid variant/out-of-stock action disabled with clear alternative"), DES-019. Milestone: this ticket set, see `T-G7C-1`'s scope-boundary note. Contributes toward `WEB-003`.

## Open question — route param is `[id]`, not `[slug]`

`docs/source/longrich-design-system-v1.1.txt` DES-004 names this route `/product/[slug]`, but `prisma/schema.prisma`'s `Product`/`ProductVariant` models (confirmed by direct read) have **no `slug` column** — only a UUID `id`. No G2 ticket added one, and inventing a slug scheme (uniqueness policy, edit-stability rule) here would be guessing a product decision, not an engineering one. **Logged as `docs/open-questions.md` #33.** This ticket builds `/product/[id]` using the existing UUID; the route is renamed to `/product/[slug]` only after #33 is resolved and a backend migration/backfill ships — that is new, separate, future work, not part of this ticket.

## Scope note — which DES-007 tabs are buildable now

Only **Tavsif** (description), **Xususiyatlar** (variant attributes), and **Do'konlar** (the seller-offer comparison list, via `OfferComparison`) are built. **Narx tarixi** (EXT-002), **Savol-javob** (EXT-003), and **Sharhlar** (EXT-004) have no backend in this codebase at all yet (confirmed in `docs/architecture/api-contract-g2.md`'s own "Out of scope" section: no read endpoint for `offer_price_history` ships in G2) — these three tabs are not rendered, not stubbed as "coming soon" placeholders, simply absent.

## Goal

Build `/product/[id]` using `GET /v1/catalog/products/{id}`, rendering product header/brand/category/description, each `ProductVariant`'s `attribute_values`, and that variant's live seller offers via `GET /v1/catalog/variants/{id}/offers` through `OfferComparison`.

## Files likely touched

- `apps/web-buyer/app/product/[id]/page.tsx` (new)
- `apps/web-buyer/app/product/[id]/product-client.tsx` (new)
- `apps/web-buyer/app/product/[id]/__tests__/product-client.test.tsx` (new)

## How we'll know it's done

- An unknown/unpublished product id (API returns `404 NOT_FOUND`) renders an explicit not-found `EmptyState` — never raw JSON, never a Next.js default error page.
- The variant selector switches rendered `attribute_values`/`OfferComparison` client-side without a full page reload; each variant's offers are fetched/cached independently per variant id.
- A variant with zero offers renders `OfferComparison`'s own empty state ("Hozircha taklif yo'q") and a disabled "Savatga qo'shish" control.
- The add-to-cart control is **permanently disabled across this entire ticket set** (no G4/cart backend exists) with a visible "Savat G4 bosqichida qo'shiladi" label attached directly to the button — same disclosure the current ad-hoc footer note makes, now attached to the actual control instead of a page-level footnote.
- Tabs (Tavsif/Xususiyatlar/Do'konlar) are keyboard-operable — at least one RTL test exercises Tab+Enter/Arrow activation of a non-default tab.
- `pnpm --filter @longrich/web-buyer test`, `lint`, `typecheck`, `build` all pass.

## Owner role

`frontend-dev`

## Depends on

T-G7C-1, T-G7C-2
