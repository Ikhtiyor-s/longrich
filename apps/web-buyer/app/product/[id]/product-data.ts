import type { CategoryDto, CursorPage, ProductDetailDto, PublicOfferDto } from '@longrich/shared-types';
import type { BreadcrumbItem } from '@longrich/ui-kit';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3999';
const MAX_BREADCRUMB_DEPTH = 10;

export type ProductDetailFetchResult =
  | { status: 'ok'; product: ProductDetailDto }
  | { status: 'not-found' }
  | { status: 'error' };

export async function fetchProductDetail(id: string): Promise<ProductDetailFetchResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/products/${id}`, { cache: 'no-store' });
    if (res.status === 404) {
      return { status: 'not-found' };
    }
    if (!res.ok) {
      return { status: 'error' };
    }
    const body = await res.json();
    return { status: 'ok', product: body.data as ProductDetailDto };
  } catch {
    return { status: 'error' };
  }
}

async function fetchCategoryById(categoryId: string): Promise<CategoryDto | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/categories/${categoryId}`, { cache: 'no-store' });
    if (!res.ok) {
      return null;
    }
    const body = await res.json();
    return body.data as CategoryDto;
  } catch {
    return null;
  }
}

export async function buildBreadcrumbTrail(categoryId: string, productTitle: string): Promise<BreadcrumbItem[]> {
  const chain: CategoryDto[] = [];
  const visited = new Set<string>();
  let currentId: string | null = categoryId;

  while (currentId && !visited.has(currentId) && chain.length < MAX_BREADCRUMB_DEPTH) {
    visited.add(currentId);
    const category = await fetchCategoryById(currentId);
    if (!category) {
      break;
    }
    chain.unshift(category);
    currentId = category.parent_id;
  }

  const items: BreadcrumbItem[] = [{ label: 'Bosh sahifa', href: '/' }];
  chain.forEach((category) => {
    items.push({ label: category.name, href: `/catalog/${category.slug}` });
  });
  items.push({ label: productTitle });
  return items;
}

export type VariantOffersFetchResult = { status: 'ok'; offers: PublicOfferDto[] } | { status: 'error' };

export async function fetchVariantOffers(variantId: string): Promise<VariantOffersFetchResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/variants/${variantId}/offers`, { cache: 'no-store' });
    if (!res.ok) {
      return { status: 'error' };
    }
    const body = await res.json();
    const page = body.data as CursorPage<PublicOfferDto>;
    return { status: 'ok', offers: page.items };
  } catch {
    return { status: 'error' };
  }
}
