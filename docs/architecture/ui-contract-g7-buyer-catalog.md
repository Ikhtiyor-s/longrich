# UI Contract — G7 Buyer-Web Catalog Slice (Home / Category Browse / Product Detail)

**Status: FROZEN.** This is the single source of truth for `T-G7C-1` through `T-G7C-6` (`tickets/g7-buyer-web-catalog/`). It mirrors `docs/architecture/api-contract-g2.md`'s rigor and format, for UI instead of HTTP: every shared component's exact TypeScript prop interface, which props are wired to real G2 data today vs. typed-but-dark (accepted, never supplied, renders nothing until a real data source exists), its DES-019 state matrix (only the states that actually apply, with reasoning), its responsive behavior at the 9 named breakpoints, and the frozen icon/accessibility pattern for the Header. Changing a shape after this ships goes back through the architect per the conflict-resolution protocol (minor clarification → dated entry appended here; real change → escalate to PM/human).

**Scope reminder (from the ticket set itself):** home (`/`), category browse (`/catalog/[categorySlug]`), product detail (`/product/[id]`) only. No cart, checkout, account, auth, search backend, store directory. Every "soft-disabled" affordance below exists so the page doesn't look unfinished — none of them persists anything.

Source documents read in full before writing this: `tickets/g7-buyer-web-catalog/T-G7C-1..6`, `docs/source/longrich-design-system-v1.1.txt` (DES-002/003/004/005/006/007/017/018/019/020), `docs/architecture/api-contract-g2.md` (incl. the `## Clarifications (post-freeze)` entry this pass added), `apps/web-buyer/app/globals.css`, `apps/web-buyer/app/home-client.tsx` + `page.tsx` (rejected ad-hoc version), `docs/open-questions.md` Addendum 6 (#33, #34), `packages/ui-kit`/`packages/shared-types` (confirmed empty G0 stubs, zero existing deps), `apps/api/src/modules/catalog/products/dto/list-products.query.dto.ts`, `apps/api/src/modules/catalog/products/products.mapper.ts` + `products.service.ts`, `apps/api/src/modules/offers/offers.mapper.ts`, `prisma/schema.prisma`'s `Seller` model, `tickets/g1/T-G1-6`.

---

## 1. Conventions (inherited or newly frozen here)

### 1.1 Styling — inherited from `T-G7C-1`, not re-litigated
CSS Modules only (`*.module.css` colocated per component). Zero inline `style={{}}`. Every color/spacing/radius value is an existing `globals.css` custom property (`--canvas`, `--surface`, `--surface-alt`, `--text-primary`, `--text-secondary`, `--divider`, `--primary`, `--primary-hover`, `--primary-soft`, `--secondary`, `--success`, `--warning`, `--danger`, `--info`, `--space-1..8`, `--radius-card`, `--radius-input`, `--radius-button`, `--nav-height`, `--content-max`). No new color/spacing/radius token is introduced by this contract.

### 1.2 Typography — not a `globals.css` token today, pinned here as literal px within DES-002's stated ranges
`globals.css` has no font-size custom properties yet (out of scope to add one here — not requested by any ticket). DES-002 gives ranges, not exact numbers; this contract picks one concrete value per level, used identically by every page in this slice:

| Level | 320–767 | 768–1023 | ≥1024 | DES-002 range it must stay inside |
|---|---|---|---|---|
| H1 (hero headline only) | 28px | 30px | 34px | 28–36 |
| H2 (section heading: "Kategoriyalar", "Barcha mahsulotlar", tab labels) | 20px | 22px | 24px | 22–28, lower end used since this is a dense catalog page, not a landing page |
| Body (card title, offer rows, descriptions) | 14px | 15px | 15px | 14–16 |
| Caption (price-block suffix, badges, breadcrumb) | 12px | 12px | 13px | 12–13 |

### 1.3 Icon primitive set — new, first use in this codebase, frozen Header accessibility pattern (resolves the literal brief complaint: no more bare-letter nav buttons)

No icon-font/icon-library dependency exists anywhere in this repo (`apps/web-buyer/package.json` confirmed — only `next`/`react`/`react-dom`). Per the instruction to check before adding a new dependency: **none is added.** A minimal inline-SVG icon set ships as part of `@longrich/ui-kit`, zero new npm dependency, satisfying T-G7C-1's own CSS-Modules/zero-new-dependency ethos extended to icons.

**File:** `packages/ui-kit/src/icons/index.ts` (new, part of `T-G7C-1`'s file list — added here explicitly since the ticket text names components but not this file; it is the direct implementation of the ticket's own "real SVG icon... every icon button... real icon and label" acceptance bar, not a new component in DES-017's list).

**Frozen shape, every icon identical:**
```ts
export interface IconProps {
  size?: number;        // default 24 (desktop Header), callers pass 20 for MobileNav's compact bar
  className?: string;   // for CSS-Modules color/spacing composition only, never inline style
}
// Every icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
//   strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" ...>
```
`aria-hidden="true"` is baked into every icon unconditionally — an icon is **never** the sole accessible name source; the ancestor `<button>`/`<a>` always carries a real `aria-label` (or visible text, for labeled nav links). This is the exact rule that fixes the brief's complaint.

**Exported icons (named, minimal set — only what Header/MobileNav/ProductCard/OfferComparison/ErrorPanel actually need):** `SearchIcon`, `MapPinIcon`, `GlobeIcon`, `ChevronDownIcon`, `UserIcon`, `HeartIcon`, `CartIcon`, `GridIcon` (categories), `HomeIcon` (MobileNav), `ScanIcon` (MobileNav "Scan/Search" slot), `AlertCircleIcon` (ErrorPanel). No icon beyond this list is added without a reason tied to a specific frozen component below — this prevents each frontend-dev ticket from inventing its own ad-hoc icon.

### 1.4 The frozen "soft-disabled affordance" pattern — ONE pattern, used everywhere a control has no backend yet

This is the single answer to brief point 6 (favorite/add-to-cart) **and** point 1 (Header's delivery/language/account/favorites/cart) **and** the home page's non-functional quick-access icons. Every "not yet wired" interactive control in this entire ticket set follows this exactly — no ticket invents a variant.

1. Rendered as a real `<button>` (an action, not a navigation — never an `<a>` with `href="#"`). **Never the native `disabled` attribute** — that removes the element from the tab order, which would fail `T-G7C-6`'s explicit "every interactive element ... reachable and operable via Tab" acceptance bar.
2. `aria-disabled="true"` on the button.
3. Visual: muted, not hidden, not low-contrast-illegible — `color: var(--text-secondary)`, background `var(--surface)` or `var(--surface-alt)`, border `var(--divider)`, `cursor: not-allowed`. Text content inside such a control, if any, must still meet the ≥4.5:1 contrast bar (muting is a token/weight choice, never a contrast violation).
4. `aria-label` states both the action and its unavailability in one string, e.g. `aria-label="Sevimlilarga qo'shish — tez orada"`. Screen-reader users get full context without relying on a visual-only tooltip.
5. Where horizontal space allows (desktop `ProductCard`, product-detail add-to-cart, desktop Header's delivery/language controls), an always-visible micro-label is shown adjacent — reuse the exact wording already fixed by `T-G7C-5` for cart: `"Savat G4 bosqichida qo'shiladi"` for any cart-related control anywhere in the app (not just product-detail); `"Tez orada"` for everything else (favorites, delivery, language, scan, account, deals, new, brands quick-access). Where space doesn't allow (24px Header icon buttons, MobileNav bottom-bar items), the micro-label collapses to a `title` attribute (desktop hover) — never the *only* mechanism, see point 6.
6. On click **or** `Enter`/`Space` while focused: fire exactly one toast, `role="status"` `aria-live="polite"`, same text as point 5's micro-label, auto-dismiss ~3000ms. Never `window.alert`. Never a silent no-op (a silent no-op on a focusable, seemingly-interactive control fails both usability and `T-G7C-6`'s keyboard-operability bar, which requires the control to be "operable," not merely focusable).
7. **Never** a fake client-side mutation that looks persisted — no optimistic heart-fill animation, no incrementing a cart-count badge, no local-storage-backed "favorites" list that survives a refresh. This is the literal `bezakli mockup` prohibition from the brief.

A single shared implementation (`packages/ui-kit/src/internal/useSoftDisabled.ts` or equivalent — frontend-dev's exact file-naming call, not frozen here, since it's a hook, not a component DES-017 names) backs every soft-disabled control so the toast/aria wiring is written once, not six times differently.

### 1.5 DES-019 state coverage — frozen per component below, not cargo-culted

General rule applied throughout section 2: a **pure presentational/display** component (`CategoryTile`, `PriceBlock`) that never fetches its own data has no `loading`/`error`/`empty` state of its own — the **page** substitutes `Skeleton` while loading and `EmptyState`/`ErrorPanel` at the grid level. A component that **owns an independent fetch** (`OfferComparison`, which refetches per selected variant) does carry its own `loading`/`error` props. `Skeleton`/`EmptyState`/`ErrorPanel` themselves have no `loading`/`error`/`empty` sub-states — they *are* those states, applying the rule recursively would be absurd and is explicitly rejected here.

---

## 2. `@longrich/ui-kit` component contracts (`T-G7C-1`, `T-G7C-2`)

### 2.1 `Header` (`T-G7C-1`)

```ts
interface HeaderProps {
  categoriesHref?: string;                 // default '/#categories' — REAL link, wired
  search: SearchComboboxProps;              // composed in, not duplicated
  deliveryLabel?: string | null;            // ALWAYS null in this ticket set — no delivery backend (G6)
  language?: { code: 'uz' | 'ru'; label: string }; // default { code: 'uz', label: 'UZ' }
  cartCount?: number;                       // renders a badge only if a positive integer is passed; omitted/0 → no badge at all (never a fabricated "0")
  onFavoritesActivate?: () => void;         // soft-disabled handler, default provided by ui-kit if omitted
  onAccountActivate?: () => void;           // soft-disabled handler, default provided
  onCartActivate?: () => void;              // soft-disabled handler, default provided
  onDeliveryActivate?: () => void;          // soft-disabled handler, default provided
  onLanguageActivate?: () => void;          // soft-disabled handler, default provided
}
```

**Elements, left to right, desktop ≥768px, each with its real/soft-disabled status and icon:**

| Element | Icon | Status | Why |
|---|---|---|---|
| Wordmark "LONGRICH Marketplace" | none (typed logotype, DES-001 — no real brand asset approved yet) | real link `/` | — |
| "Barcha kategoriyalar" | `GridIcon` + visible text label (not icon-only, so no bare-letter risk at all) | **real**, `href={categoriesHref}` | `#categories` section genuinely exists on Home |
| `SearchCombobox` | `SearchIcon` (inside the input, decorative) | real input, inert submit (§2.4) | no search backend |
| Delivery address | `MapPinIcon` | **soft-disabled** | no address/delivery backend (G6); never shows a fake address, shows the static placeholder text "Yetkazib berish manzili" |
| Language | `GlobeIcon` + "UZ" text + `ChevronDownIcon` | **soft-disabled** | no i18n library wired in `apps/web-buyer` yet (confirmed: no `next-intl`/similar dependency) — this is a judgment call beyond the brief's literal list, see §4 |
| Favorites | `HeartIcon` | **soft-disabled** | no favorites backend |
| Account | `UserIcon` | **soft-disabled** | no buyer auth wired to this app |
| Cart | `CartIcon` (+ optional count badge) | **soft-disabled** | no cart backend (G4) |

Every icon button's `aria-label` names the action in Uzbek (e.g. `"Yetkazib berish manzilini tanlash — tez orada"`, `"Sevimlilar — tez orada"`, `"Savat — tez orada"`, `"Tilni tanlash — tez orada"`) — never a bare letter, never generic "button."

**DES-019 states applied:** default, focus (visible ring on every interactive child, `outline`/`box-shadow` using `var(--primary)` at ≥3:1 against `var(--surface)`), active (CSS `:active`, pressed look), soft-disabled (§1.4) for delivery/language/favorites/account/cart. No loading/error/empty — `Header` is static chrome, owns no async data.

**Responsive rules (all 9 breakpoints):**
- 320–767: `Header`'s desktop bar is **not rendered at all** — replaced entirely by a compact mobile bar (wordmark, abbreviated or hidden below 360px, + full-width `SearchCombobox` + `CartIcon` soft-disabled button) plus `MobileNav` fixed at the bottom. Delivery/language/favorites/account move out of the top bar entirely at this width (favorites/account live in `MobileNav`; delivery/language are simply absent on mobile in this slice — not lost functionality, since none of them do anything yet; re-introducing them on mobile is a future-slice decision once real backends exist).
- 768–1023: full desktop `Header` renders, but `SearchCombobox` max-width clamps to 320px (less horizontal room); delivery label text truncates with ellipsis at ~140px.
- 1024–1365: `SearchCombobox` max-width 480px; full label text for delivery/language.
- 1366–1920: `SearchCombobox` max-width 640px ("central wide search" per DES-003); outer content wrapped in `max-width: var(--content-max)` (1400px), centered — no further element resizing beyond 1366, only growing side margins.
- `height: var(--nav-height)` (72px) fixed at every breakpoint ≥768 — within DES-003's 64–80px allowance, never recalculated per breakpoint.

### 2.2 `MobileNav` (`T-G7C-1`)

```ts
interface MobileNavProps {
  activeItem?: 'home' | 'categories' | 'scan-search' | 'favorites' | 'profile';
  onScanSearchActivate?: () => void;   // soft-disabled — no camera/scan feature on web in this slice
  onFavoritesActivate?: () => void;    // soft-disabled
  onProfileActivate?: () => void;      // soft-disabled
}
```
Home (`/`) and Categories (`/#categories`) are real links (`<Link>`), `GridIcon`/`HomeIcon` + visible text label under each icon (never icon-only — same anti-bare-letter rule as Header). Scan-Search/Favorites/Profile use `ScanIcon`/`HeartIcon`/`UserIcon`, each soft-disabled per §1.4.

**States:** default, focus, active, soft-disabled (3 of 5 items). No loading/error/empty.

**Responsive:** rendered only <768px (hidden ≥768 via CSS, not JS-conditional mount — avoids layout-shift/hydration mismatch). Fixed `position: fixed; bottom: 0`, `padding-bottom: env(safe-area-inset-bottom)` (DES-003 "safe areas"). 5 equal-width flex items; minimum touch target 44×44px satisfied at all widths down to 320px (320÷5 = 64px column, icon+label fits comfortably). Identical layout at 320/360/375/390 — no breakpoint-specific change below 768.

### 2.3 `AppShell` (`T-G7C-1`)

```ts
interface AppShellProps {
  children: React.ReactNode;
  header: HeaderProps;
  mobileNav?: MobileNavProps;   // if omitted, AppShell derives sensible defaults from `header`'s handlers
  footer?: React.ReactNode;     // default: a small neutral text line, e.g. "G7 — katalog bo'limi. Savat/kirish keyingi bosqichlarda qo'shiladi." NEVER a stats panel (see §4 point 3 — this is non-negotiable)
}
```
Renders `Header` (≥768) / compact mobile bar + `MobileNav` (<768) chrome, a `<main>` with `max-width: var(--content-max)` centered, fluid side padding (16px at 320–767, 24px at 768–1023, 32px at ≥1024, per DES-003's 20–32px margin guidance), and the footer slot.

**States:** default only. No loading/error/empty of its own — `AppShell` owns no data; `children` carry their own states.

### 2.4 `SearchCombobox` (`T-G7C-1`)

```ts
interface SearchComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;   // INERT in this ticket set — no caller in T-G7C-3/4/5 wires this to a fetch or filter
  placeholder?: string;                 // default "Mahsulot qidirish..."
}
```
**Frozen as explicitly non-functional** (ticket's own requirement — `GET /v1/catalog/products` has no `q` param per `list-products.query.dto.ts`, confirmed by direct read: only `cursor`/`limit`/`category_id`). The component itself must never call `fetch` or filter an in-memory list — that responsibility, if it ever exists, belongs to a future ticket once a search backend exists. The internal submit affordance (`SearchIcon` button) is disabled (native `disabled`, not soft-disabled — pressing Enter/clicking submit on an empty string legitimately does nothing useful, this is the one place native `disabled` is correct because there is no "action" being blocked, just an empty-input no-op) when `value.trim() === ''`.

**States:** default, focus (ring), filled (non-empty value, submit button enabled). No loading/error/empty.

**Responsive:** full-width within its slot at every breakpoint — on mobile (<768) the input is always visible and expanded (not a collapse-to-icon pattern), matching DES-003's "compact brand/search" (both visible together, just smaller), avoiding an extra interaction state the ticket doesn't ask for.

### 2.5 `Breadcrumb` (`T-G7C-1`)

```ts
interface BreadcrumbItem { label: string; href?: string; } // href omitted on the last (current) item
interface BreadcrumbProps { items: BreadcrumbItem[]; }
```
Renders `null` (zero DOM output) when `items.length === 0` — the ticket's own "empty (zero-crumb)" state. Last item gets `aria-current="page"`, no link. `<nav aria-label="Yo'nalish">` wrapping an ordered list.

**States:** default, empty. No loading of its own — the category page computes the full trail client-side before ever rendering `Breadcrumb` at all (while that computation is pending, the page shows `Skeleton`, not an empty `Breadcrumb`).

**Responsive:** single line, wraps if needed; on <390px with >3 levels, middle segments collapse to `…` (never horizontal scroll for a 2–4 item trail — DES-019 "no horizontal overflow except an intentional data grid," a breadcrumb is not one).

### 2.6 `ProductCard` (`T-G7C-2`)

```ts
interface ProductCardProps {
  id: string;
  title: string;
  href: string;                          // `/product/${id}` — wired

  // --- WIRED TO REAL DATA TODAY ---
  coverImageUrl?: string | null;         // resolved from cover_media.object_key by the page; null → neutral placeholder square (var(--surface-alt)), never a broken <img>, never a fake stock photo
  priceMinor?: string | null;            // resolved by the PAGE via the variants→offers walk (see §3.1 — NOT a pass-through of offers_summary.lowest_price_minor, which is confirmed always null/0 in the live API today, see api-contract-g2.md's 2026-10-20 note and tickets/FOUND-DEBT.md)
  currency?: string;                     // same source as priceMinor

  // --- TYPED, BUT INTENTIONALLY DARK (no caller in this ticket set ever supplies these) ---
  rating?: { average: number; verifiedCount: number } | null;  // no EXT-004 backend (review rating) exists at all; renders nothing when absent — NEVER "0 sharh"
  sellerName?: string | null;            // deliberately never wired here even after the offers endpoint gains seller_name (see §4) — a product card represents possibly-multiple sellers' offers_summary; showing "the" seller would misrepresent multi-vendor reality (DES-005's own rule)
  stockLabel?: string | null;            // no inventory backend (G3); NEVER "Omborda bor"/"tugadi" invented
  deliveryLabel?: string | null;         // no shipping backend (G6)

  onFavoriteActivate?: () => void;       // soft-disabled (§1.4)
  onAddToCartActivate?: () => void;      // soft-disabled (§1.4); additionally forced soft-disabled whenever priceMinor is null/absent, regardless of the handler passed
}
```

**No-price branch (frozen, ticket-mandated):** when `priceMinor` is `null`/`undefined`, `PriceBlock` renders the muted text "Narx mavjud emas" instead of any number, and the add-to-cart control is soft-disabled (in addition to being backend-wise soft-disabled already) with the micro-label "Narx mavjud emas" taking visual priority over the generic "Tez orada" wording in that specific case.

**Image:** 1:1 aspect ratio, `object-fit: contain` (DES-002 — never crop a product/label), `var(--radius-input)` corners.

**DES-019 states:** default, hover (CSS lift/border-color change), focus (the whole card's primary link target gets a visible ring, not just an invisible focus on the outer `<article>`), favorite/add-to-cart soft-disabled (§1.4), no-price branch (above). **No `loading`/`error`/`empty` prop** — the grid substitutes `Skeleton(variant="product-card")` while the page fetches, and `EmptyState`/`ErrorPanel` at the grid level; a single `ProductCard` is never itself "empty" or "erroring."

**Responsive — product/category grid column counts (frozen identically for Home and Category-browse, per §4 point 7's single-grid decision):**

| Breakpoint | Columns |
|---|---|
| 320–767 | 2 |
| 768–1023 | 3 |
| 1024–1365 | 4 |
| 1366–1920 | 5 |

Gap: `var(--space-4)` at 320–767, `var(--space-5)` at ≥768. Card min-width enforced via the grid (`minmax(0, 1fr)` inside a fixed column-count grid, not `auto-fill`, so the column count is deterministic at every breakpoint, not content-dependent).

### 2.7 `CategoryTile` (`T-G7C-2`)

```ts
interface CategoryTileProps {
  id: string;
  slug: string;
  name: string;
  href: string;                 // `/catalog/${slug}` — wired
  imageUrl?: string | null;     // ALWAYS omitted by every caller in this ticket set — see finding below
  productCount?: number;        // ALWAYS omitted by every caller — GET /v1/catalog/categories has no count field, confirmed by direct read of api-contract-g2.md's response shape
}
```

**Finding beyond the brief's literal wording (flagged explicitly, not silently absorbed):** DES-005/the brief both say "image + name" for category tiles, and `T-G7C-2`'s own ticket text frames `imageUrl` as if it might sometimes be supplied. Direct read of `api-contract-g2.md`'s `GET /v1/catalog/categories` response shape shows categories have **no image field at all** — not even optionally (`id, parent_id, slug, name, status, requires_certification, created_at, updated_at, version`). So in this ticket set, `CategoryTile.imageUrl` is typed-but-permanently-dark, exactly like `ProductCard.rating`: every real caller omits it, and the tile always renders its neutral placeholder square (`var(--surface-alt)`, 1:1, no fake category photo) rather than ever showing a stock image. This is the same honesty rule applied one level deeper than the brief's own text anticipated.

**States:** default, hover, focus, active. No loading/error/empty of its own (grid-level `Skeleton`/`EmptyState` as above).

**Responsive — category grid column counts (distinct from the product grid, per DES-005's explicit "6 columns desktop" vs. DES-006's "4-5" for products):**

| Breakpoint | Columns |
|---|---|
| 320–767 | 2 |
| 768–1023 | 3 |
| 1024–1365 | 4 |
| 1366–1920 | 6 |

### 2.8 `PriceBlock` (`T-G7C-2`)

```ts
interface PriceBlockProps {
  priceMinor: string | null;            // digit-string ÷ 100, toLocaleString('ru-RU') + " so'm" suffix; null → "Narx mavjud emas" (muted, var(--text-secondary))
  previousPriceMinor?: string | null;   // struck-through ONLY when explicitly passed — never inferred, never defaulted from any other field (DES-018)
  currency?: string;                    // 'UZS' is the only allowlisted MVP value per api-contract-g2.md; suffix text "so'm" is hardcoded for that reason, not a guessed business rule
  size?: 'sm' | 'md' | 'lg';             // default 'md'
}
```
Mono/tabular figures per DES-002 ("mono figures for... price refs") — `font-variant-numeric: tabular-nums`.

**States:** default (with price), no-price (muted text), with-previous (struck price shown). Purely presentational — no loading/error/empty.

### 2.9 `Skeleton` (`T-G7C-2`)

```ts
interface SkeletonProps {
  variant: 'product-card' | 'category-tile' | 'offer-row' | 'text-line';
  count?: number;   // default 1
}
```
**States:** default render only (it IS the loading state; no sub-states).

### 2.10 `EmptyState` (`T-G7C-2`)

```ts
interface EmptyStateProps {
  title?: string;         // default "Hech narsa topilmadi"
  description?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}
```
**States:** default, custom-message (title/description overridden). Used for: zero categories, zero products, unknown category slug (`T-G7C-4`), unknown/unpublished product id → `404` (`T-G7C-5`), zero offers for a variant (via `OfferComparison`'s own empty branch, §2.11 — not this component directly, see below).

### 2.11 `ErrorPanel` (`T-G7C-2`)

```ts
interface ErrorPanelProps {
  message?: string;    // default "Xatolik yuz berdi. Keyinroq qayta urinib ko'ring."
  onRetry?: () => void; // retry button renders ONLY if this is present — never a dead/non-functional button
}
```
**States:** default, with-retry (button present and tested to actually fire `onRetry` on click/Enter). Replaces today's silent `return []` swallow in `page.tsx`'s `getCategories`/`getProducts` — a real fetch failure must render this, not an empty grid indistinguishable from "genuinely zero items."

### 2.12 `OfferComparison` (`T-G7C-2`)

```ts
interface OfferComparisonProps {
  offers: PublicOfferDto[];              // GET /v1/catalog/variants/{id}/offers items — see §3 for the DTO, incl. seller_name (pending the clarification in api-contract-g2.md)
  isLoading?: boolean;                   // true while this variant's offers are (re)fetching — OWNS this state because variant switching refetches independently per T-G7C-5
  error?: string | null;                 // set on fetch failure for the current variant
  onRetry?: () => void;
  onAddToCartActivate?: (offerId: string) => void;  // soft-disabled (§1.4)
}
```
Rows sorted ascending by `price_minor` (parsed as `BigInt`, never a lossy `Number()` comparison on large values — consistent with the frozen wire-string convention). Empty array (not loading, not error) → exact copy "Hozircha taklif yo'q" (ticket-mandated, verbatim) plus a disabled "Savatga qo'shish" control.

**This is the ONE component in this ticket set that owns its own async fetch**, which is why — unlike `ProductCard`/`CategoryTile` — it legitimately carries `loading`/`error` props itself rather than deferring to the page. While `isLoading`, render `Skeleton(variant="offer-row", count=2)` in place of rows. While `error`, render `ErrorPanel` inline (same component, reused, not a second bespoke error UI).

**Responsive:** never a column grid — a single-column row list at every breakpoint. Desktop (≥768) row layout: horizontal flex (seller name | price | fulfillment mode | add-to-cart). Mobile (<768): each row stacks into a compact card (seller name + price on one line, fulfillment mode + button below) to avoid horizontal overflow (DES-019 — this is a list, not an "intentional data grid," so no horizontal scroll is permitted).

---

## 3. Shared DTOs (`packages/shared-types/src/catalog.ts`, `T-G7C-2`)

Typed exactly against `api-contract-g2.md`'s frozen field names — never a guessed name, never a `camelCase` wire field.

```ts
export interface CategoryDto {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  requires_certification: boolean;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface OffersSummaryDto {
  active_offer_count: number;
  lowest_price_minor: string | null;
  currency: string | null;
}

export interface ProductListItemDto {
  id: string;
  category_id: string;
  brand: { id: string; name: string } | null;
  title: string;
  status: 'PUBLISHED';
  cover_media: { object_key: string; position: number } | null;
  offers_summary: OffersSummaryDto;   // CONFIRMED always zero-valued in the live API today — do not read price/count from this field, see §2.6
}

export interface ProductAttributeValueDto {
  category_attribute_id: string;
  key: string;
  value: unknown;
}

export interface ProductMediaDto {
  id: string;
  object_key: string;
  position: number;
  moderation_status: 'APPROVED';   // confirmed server-pre-filtered to APPROVED-only on every public response; frontend MUST NOT re-filter by this field
}

export interface ProductVariantDto {
  id: string;
  product_id: string;
  options: Record<string, string>;
  status: string;
  attribute_values: ProductAttributeValueDto[];
  media: ProductMediaDto[];
  offers_summary: OffersSummaryDto;   // same "always zero today" caveat as above
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ProductDetailDto {
  id: string;
  category_id: string;
  brand: { id: string; name: string } | null;
  title: string;
  description: string;
  status: string;
  canonical_id: string | null;
  variants: ProductVariantDto[];
  media: ProductMediaDto[];
  offers_summary: OffersSummaryDto;
  latest_moderation_decision: { outcome: string; reason: string | null; decided_at: string } | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface PublicOfferDto {
  id: string;
  seller_id: string;
  seller_name: string;     // additive field — see api-contract-g2.md "Clarifications (post-freeze)", 2026-10-20; verify it is live before wiring, see §4
  seller_sku: string;
  price_minor: string;
  currency: string;
  fulfillment_mode: string;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}
```

---

## 4. Decisions superseding / resolving PM's gaps

### 4.1 Gap #33 (slug) — CONFIRMED, not superseded

`docs/open-questions.md`'s existing resolution stands unchanged: `/product/[id]` using the UUID, no slug invented. This contract's `ProductDetailDto.id` is the only identifier `T-G7C-5`'s route uses. Nothing in this UI contract depends on a slug existing for products.

### 4.2 Gap #34 (seller name) — RESOLVED: add the field, scoped narrowly

**The call:** add `seller_name` to `GET /v1/catalog/variants/{id}/offers` only (not a new endpoint, not a store-directory surface). Justification:
- `sellers.display_name` (VARCHAR(120), NOT NULL) already exists, already designed in `T-G1-6` as the seller's *public-facing* storefront name — distinct from the private `legal_name`/`tax_id` the brief explicitly said must stay excluded. No new sensitive data is exposed.
- The `offers` module's public-offers query already joins to `Seller` to enforce the existing `status='ACTIVE'` filter (frozen in the original G2 contract) — adding `displayName` to that same `select` is a one-line, additive, non-breaking change. No migration, no new table, no new route.
- This is classified as a **minor clarification** to the frozen `api-contract-g2.md` (dated entry appended, see that document), not a "real design change" requiring PM/human escalation and a sprint pause — the conflict-resolution protocol reserves that heavier path for new endpoints/schema changes, which this is not.
- A tiny backend-dev addition is still required (two files: `offers.mapper.ts`, `seller-offers.service.ts` — exact lines named in `api-contract-g2.md`'s Clarifications entry) and has **not shipped yet** as of this writing (confirmed by direct code read). This is flagged to PM to open as a short backend-dev ticket; it is not one of `T-G7C-1..6` (those are all frontend-dev-owned and cannot touch `apps/api`).
- **`ProductCard.sellerName` stays typed-but-permanently-dark in this ticket set regardless** — a product card's `offers_summary` can represent multiple sellers' offers at once, and DES-005 itself prohibits silently combining/attributing multi-seller data to one identity. Seller name is correct to surface only where offers are enumerated individually: `OfferComparison`, on the product-detail page. This is a design reason, not just a data-availability gap — even if `offers_summary` someday carries a real seller, a single card-level "seller name" field would misrepresent a multi-vendor product.
- No store directory (`/stores`, `/stores/[slug]`) is built — confirmed out of scope, matching PM's own gap note.

### 4.3 Gap #7 (popular/new/recommended sections) — RESOLVED: one plain grid, no fake curation

Confirmed by direct read of `list-products.query.dto.ts`: `GET /v1/catalog/products` accepts only `cursor`, `limit`, `category_id` — no `sort` parameter, no way to distinguish "trending"/"newest"/"recommended" from "everything." The cursor convention's fixed ordering (`created_at ASC, id ASC`) is oldest-first by creation, which is the *opposite* of a "new arrivals" framing — labeling it "Yangi mahsulotlar" would misrepresent page-1-of-everything as curated new content.

**Frozen:** Home page ships exactly **one** product grid, heading text "Barcha mahsulotlar" (or equivalent neutral wording). The words "Mashhur"/"Popular", "Yangi"/"New", "Tavsiya etilgan"/"Recommended" **MUST NOT** appear as a section label anywhere in `T-G7C-3`/`T-G7C-4`. This is the direct, literal application of DES-005's own rule ("default trending from real published offers" — there is no real trending signal, so no trending section exists) and the brief's own instruction.

### 4.4 Judgment call beyond the brief's literal list: Header's language selector is also soft-disabled

The brief's header requirement list names "language" as a required element but doesn't specify whether it must function. Direct check of `apps/web-buyer/package.json` confirms no i18n library (`next-intl` or equivalent) is wired into this app yet — DES-019's "all labels UZ/RU via i18n key" bar isn't met by the codebase today, for any label, not just the switcher. Applying the same honesty principle driving every other decision in this document: the language control is real UI (Globe icon + "UZ" + chevron) but **soft-disabled** (§1.4), not a working UZ↔RU toggle. Flagged explicitly as a judgment call, not silently assumed.

### 4.5 Hero banner sizing (brief point 2)

No CMS exists (`SeoCmsModule` confirmed, by direct grep + file read, to be an empty `ADR-001` stub — `export class SeoCmsModule {}`, nothing else). Per DES-005's own rule and the brief: the hero carries **no** promotional/countdown/deal claim and **no** large empty reserved block. Frozen shape for `T-G7C-3`'s Home page (page-local markup, not a new `ui-kit` export — not named in `T-G7C-1`/`T-G7C-2`'s component lists):

- Single full-width band (no 1/3 "promo card" slot — DES-005 marks that slot optional, and there is no real content for it; omitting it entirely is more honest than reserving empty space for it).
- Content: static brand statement (H1, §1.2's sizing) + one-sentence subcopy + one primary CTA button linking to `#categories` (anchors into the real category grid below — not a fake "shop now" link to nowhere).
- Background: `var(--secondary)` solid/token-based panel (reusing the old ad-hoc version's dark-teal treatment, which the user never objected to — only the adjacent stats panel was rejected), never a stock "lifestyle photo" that doesn't exist.
- **Modest, explicit height per breakpoint** (never full-viewport): min-height 200px (320–767), 240px (768–1023), 280px (≥1024). This directly answers "balanced, not oversized."

### 4.6 Platform-stats panel (brief point 3)

Confirmed removed, not re-added anywhere: `AppShell`'s footer slot (§2.3) is a plain text line, never a metrics panel; no component in §2 renders a category/product count anywhere on the buyer Home. If a future ticket wants platform metrics, that belongs in an admin analytics surface — out of scope for every component this document freezes.

---

## 5. Page composition contracts

### 5.1 Home (`/`, `T-G7C-3`)

**Order, top to bottom:** `AppShell` chrome → Hero (§4.5) → 6 quick-access icons → Category grid (`CategoryTile`, §2.7) → single product grid (`ProductCard`, §2.6, §4.3).

**Quick-access icons — exact real/soft-disabled status per item (DES-005 names 6: Categories/Deals/Scanner/New/Delivery/Brands):**

| Item | Status | Reason |
|---|---|---|
| Kategoriyalar | **real**, scrolls to `#categories` | section genuinely exists on this page |
| Aksiyalar (Deals) | soft-disabled | no CMS/promotions backend |
| Skaner (Scanner) | soft-disabled | no camera/barcode-scan feature built for web in this slice |
| Yangi (New) | soft-disabled | no `sort=newest` param, see §4.3 |
| Yetkazib berish (Delivery) | soft-disabled | no shipping module (G6) |
| Brendlar (Brands) | soft-disabled, **for a different reason than the others** | `GET /v1/catalog/brands` IS a real, live public endpoint — but no frontend route/page for a brand listing exists in `T-G7C-1..6`. This is a page-scope gap, not a data-availability gap; flagged so a future ticket building a `/brands` page doesn't have to also build the data fetch from scratch |

**Data source (frozen, matches `T-G7C-3`'s own text exactly):** `GET /v1/catalog/categories?limit=100` (filter to `parent_id !== null` for the tile grid, same as today's `page.tsx`), `GET /v1/catalog/products?limit=24`, then **for each product**, walk `GET /v1/catalog/products/{id}` → `variants[]` → `GET /v1/catalog/variants/{id}/offers` → first item's `price_minor`/`currency` → passed into `ProductCard.priceMinor`/`currency`. This is the existing `page.tsx` N+1 pattern, kept deliberately (see §2.6, `api-contract-g2.md`'s 2026-10-20 note, `tickets/FOUND-DEBT.md`) because `offers_summary` is confirmed non-functional in the live API today.

**Loading/empty/error:** `Skeleton` grids while the above resolves; `EmptyState` if `categories`/`products` resolve to `[]`; `ErrorPanel` with retry if either top-level fetch (`categories`/`products`) returns non-OK — **new behavior**, replacing today's silent `return []`.

### 5.2 Category browse (`/catalog/[categorySlug]`, `T-G7C-4`)

**Order:** `AppShell` → `Breadcrumb` (walked client-side via `parent_id` against the already-fetched flat category list) → H2 category name → `ProductCard` grid (§2.6 column rules) → "Yana yuklash" cursor pagination button (disabled/hidden once `next_cursor` is `null`).

**No facet/sort/filter UI renders anywhere on this page** — confirmed: `GET /v1/catalog/products` supports only `category_id` as an executable filter; DES-006's full facet bar is explicitly not built here (per `T-G7C-4`'s own Scope note). The only "filter" is the route param itself.

**Unknown slug:** `EmptyState` with not-found messaging — never a crash, never a silent fallback to "all products."

### 5.3 Product detail (`/product/[id]`, `T-G7C-5`)

**Order:** `AppShell` → minimal page-local media display (cover image + thumbnail strip from `media[]`, already server-filtered to `APPROVED`-only per §3's `ProductMediaDto` note — **not** the full DES-017 `PhotoGallery` component, which isn't named in `T-G7C-1`/`T-G7C-2`'s file lists and is out of scope for this slice; keyboard/touch gallery depth beyond basic thumbnail-click is deferred, flagged, not silently claimed complete) → title/brand/category header → variant selector (switches `attribute_values` + triggers an independent `OfferComparison` refetch, §2.12) → tabs: **Tavsif / Xususiyatlar / Do'konlar only** (Narx tarixi/Savol-javob/Sharhlar have zero backend, per `T-G7C-5`'s own Scope note — absent, not stubbed) → `OfferComparison` inside "Do'konlar" → permanently soft-disabled "Savatga qo'shish" CTA with the fixed label "Savat G4 bosqichida qo'shiladi" attached directly to the button (§1.4 point 5, reused verbatim).

**404 (unknown/unpublished id):** `EmptyState`, never raw JSON, never Next.js's default error page.

**Zero offers for selected variant:** `OfferComparison`'s own empty branch ("Hozircha taklif yo'q") + disabled cart control — not a page-level `EmptyState` (the product itself exists and rendered fine; only the offer list is empty).

---

## 6. Breakpoint summary (all 9, cross-component)

| Breakpoint | Header/MobileNav | Category grid | Product grid | Hero min-height |
|---|---|---|---|---|
| 320 | MobileNav | 2 col | 2 col | 200px |
| 360 | MobileNav | 2 col | 2 col | 200px |
| 375 | MobileNav | 2 col | 2 col | 200px |
| 390 | MobileNav | 2 col | 2 col | 200px |
| 768 | Header | 3 col | 3 col | 240px |
| 1024 | Header | 4 col | 4 col | 280px |
| 1366 | Header | 6 col | 5 col | 280px |
| 1440 | Header (centered, `--content-max`) | 6 col | 5 col | 280px |
| 1920 | Header (centered, `--content-max`) | 6 col | 5 col | 280px |

No horizontal overflow at any listed width on any of the three pages (verified at design time by the column math above: smallest card width at 320px÷2 cols, minus gap, stays comfortably >120px, never forcing a scrollbar).

---

## 7. Out of scope (elaborating the ticket set's own boundaries)

- **`PhotoGallery` (DES-017's full component).** Not built — product-detail ships a minimal cover+thumbnail strip only (§5.3). Almost got designed in as a full ui-kit export; dropped because neither `T-G7C-1` nor `T-G7C-2`'s file lists name it, and no ticket's acceptance bar tests gallery keyboard/touch depth.
- **`SellerBadge`/`DiscountBadge`/`Ratings`/`BarcodeLookup`/`FilterChips`/`Tabs`-as-a-shared-component (DES-017 names a generic `Tabs`).** `T-G7C-5` needs tab behavior but no ticket's file list names a shared `Tabs` export — built page-local inside `product-client.tsx` for this slice, not promoted to `ui-kit` yet (no second consumer exists to justify extraction).
- **i18n / RU locale.** No library wired; language selector is soft-disabled (§4.4). Full UZ/RU parity (DES-019) is not met by this slice and is logged, not silently claimed.
- **`/brands`, `/stores`, `/search` pages.** Confirmed absent — Brands has a live backend endpoint with no frontend page (§5.1); Stores has neither (gap #34, narrowly resolved only for offer-level seller name, §4.2); Search has neither backend nor frontend (§2.4).
- **Real encryption/validation of anything touched here.** None of this ticket set's data is sensitive (public catalog reads only) — not applicable, noted for completeness since `api-contract-g2.md` carries similar notes elsewhere.
