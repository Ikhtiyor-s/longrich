import type { BreadcrumbItem } from '@longrich/ui-kit';
import type { CategoryDto, CursorPage, ProductListItemDto } from '@longrich/shared-types';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3999';
const PRODUCTS_PAGE_SIZE = 24;

export interface CategoryProductCardData {
  id: string;
  title: string;
  href: string;
  coverImageUrl: string | null;
  priceMinor: string | null;
  currency?: string;
}

interface PublicOfferItem {
  price_minor: string;
  currency: string;
}

export async function fetchCategories(): Promise<CategoryDto[] | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/categories?limit=100`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return body.data.items as CategoryDto[];
  } catch {
    return null;
  }
}

export function resolveCategoryBySlug(categories: CategoryDto[], slug: string): CategoryDto | null {
  return categories.find((category) => category.slug === slug) ?? null;
}

export function buildBreadcrumbTrail(categories: CategoryDto[], category: CategoryDto): BreadcrumbItem[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const visited = new Set<string>();
  const chain: CategoryDto[] = [];

  let current: CategoryDto | undefined = category;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }

  const items: BreadcrumbItem[] = [{ label: 'Bosh sahifa', href: '/' }];
  chain.forEach((c, index) => {
    const isLast = index === chain.length - 1;
    items.push({ label: c.name, href: isLast ? undefined : `/catalog/${c.slug}` });
  });
  return items;
}

export async function fetchCategoryProductsPage(
  categoryId: string,
  cursor?: string,
): Promise<CursorPage<ProductListItemDto> | null> {
  try {
    const params = new URLSearchParams({ category_id: categoryId, limit: String(PRODUCTS_PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${API_BASE_URL}/v1/catalog/products?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return body.data as CursorPage<ProductListItemDto>;
  } catch {
    return null;
  }
}

async function resolvePriceForProduct(productId: string): Promise<{ priceMinor: string | null; currency?: string }> {
  try {
    const detailRes = await fetch(`${API_BASE_URL}/v1/catalog/products/${productId}`, { cache: 'no-store' });
    if (!detailRes.ok) return { priceMinor: null };
    const detail = await detailRes.json();
    const variants = (detail.data.variants ?? []) as Array<{ id: string }>;

    for (const variant of variants) {
      const offersRes = await fetch(`${API_BASE_URL}/v1/catalog/variants/${variant.id}/offers`, {
        cache: 'no-store',
      });
      if (!offersRes.ok) continue;
      const offersBody = await offersRes.json();
      const offers = (offersBody.data.items ?? []) as PublicOfferItem[];
      const firstOffer = offers[0];
      if (firstOffer) {
        return { priceMinor: firstOffer.price_minor, currency: firstOffer.currency };
      }
    }
    return { priceMinor: null };
  } catch {
    return { priceMinor: null };
  }
}

export async function resolveProductCardData(item: ProductListItemDto): Promise<CategoryProductCardData> {
  const { priceMinor, currency } = await resolvePriceForProduct(item.id);
  return {
    id: item.id,
    title: item.title,
    href: `/product/${item.id}`,
    coverImageUrl: null,
    priceMinor,
    currency,
  };
}
