# T-G7C-2 — `@longrich/ui-kit` content primitives (ProductCard, CategoryTile, PriceBlock, Skeleton, EmptyState, ErrorPanel, OfferComparison)

**Requirement refs:** DES-002 (image ratio 1:1 object-contain for product cards; mono figures for price refs; UZS format "12 500 so'm"), DES-005 (category tile: image crop + localized label + product count **only if the API supplies one**; product card: image, favorite action, seller/verified badge, readable 2-line title, rating/verified-purchase metric, current UZS price, previous price struck only if genuine, availability, add-to-cart), DES-007 (offer comparison: "compare offers by seller name, actual listed price, delivery window/fee, stock availability, fulfillment mode, seller reputation … a seller offer is not a duplicate global product"), DES-017 (`ProductCard`, `CategoryTile`, `PriceBlock`, `Skeleton`, `EmptyState`, `ErrorPanel`, `OfferComparison` — typed, tested), DES-018 (no deceptive "only 1 left," no fake discount — `PriceBlock` never renders a struck previous price unless genuinely passed one), DES-019 (loading/empty/error are literal, testable component states, not assumed free inside a page). Milestone: this ticket set, see `T-G7C-1`'s scope-boundary note.

**Migration:** None.

## Goal

Build the seven content-display primitives DES-017 names that the home, category-browse, and product-detail pages (`T-G7C-3/4/5`) all share, each typed against the **exact** `docs/architecture/api-contract-g2.md` response shapes — not a guessed field name — each with its applicable DES-019 state matrix and an RTL unit test. Reuses the CSS Modules approach and test tooling `T-G7C-1` establishes.

## Files likely touched

- `packages/ui-kit/src/{ProductCard,CategoryTile,PriceBlock,Skeleton,EmptyState,ErrorPanel,OfferComparison}/*.{tsx,module.css,test.tsx}`
- `packages/ui-kit/src/index.ts` (export additions)
- `packages/shared-types/src/catalog.ts` (new) — typed `CategoryDto`, `ProductListItemDto`, `ProductDetailDto`, `ProductVariantDto`, `PublicOfferDto` mirroring `api-contract-g2.md`'s field names/shapes exactly (e.g. `price_minor` typed as `string`, never `number`, per that document's frozen BIGINT-as-string wire convention) — one shared source of truth instead of `apps/web-buyer/app/page.tsx`/`home-client.tsx`'s current independently-duplicated ad-hoc `interface Category {...}` blocks.

## How we'll know it's done

- `ProductCard` props match `GET /v1/catalog/products` list-item shape exactly (`id, title, cover_media, offers_summary.{active_offer_count, lowest_price_minor, currency}`) — a test asserts `offers_summary.active_offer_count === 0` renders "Narx mavjud emas" with a disabled add-to-cart control, never a fabricated price.
- `CategoryTile` renders a product-count badge **only** when the caller explicitly supplies one as a prop — `GET /v1/catalog/categories` does not return a count field per the contract, so for this slice `CategoryTile` is always rendered without one, and a test asserts no count is fabricated when the prop is omitted.
- `PriceBlock` formats a `price_minor` digit-string ÷ 100 with a `so'm` suffix and `toLocaleString('ru-RU')` grouping (matching — and centralizing — the conversion logic `apps/web-buyer/app/page.tsx` currently inlines ad hoc); a struck previous price renders only when a `previousPriceMinor` prop is explicitly passed, never inferred from any other field.
- `OfferComparison` renders one row per `GET /v1/catalog/variants/{id}/offers` item (`seller_id, seller_sku, price_minor, currency, fulfillment_mode`), sorted ascending by price, with an explicit empty state ("Hozircha taklif yo'q") when the array is empty — never silently renders nothing.
- `Skeleton` has a default-render test; `EmptyState` has a default + custom-message test; `ErrorPanel` has a test asserting its retry callback actually fires on click/Enter.
- Zero `style={{...}}` inline objects; only `globals.css` tokens referenced in any new `.module.css`.
- `pnpm --filter @longrich/ui-kit test/lint/typecheck` and `pnpm --filter @longrich/shared-types typecheck` all pass.

## Owner role

`frontend-dev`

## Depends on

T-G7C-1 (reuses its CSS Modules convention and Jest/RTL tooling; no code-level import dependency, sequenced after only so the test setup isn't duplicated)
