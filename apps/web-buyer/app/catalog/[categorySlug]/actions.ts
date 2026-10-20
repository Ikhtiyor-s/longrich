'use server';

import type { CategoryProductCardData } from './catalog-data';
import { fetchCategoryProductsPage, resolveProductCardData } from './catalog-data';

export interface LoadMoreCategoryProductsResult {
  items: CategoryProductCardData[];
  nextCursor: string | null;
  error: string | null;
}

const PRODUCTS_FETCH_ERROR = "Mahsulotlarni yuklashda xatolik yuz berdi. Keyinroq qayta urinib ko'ring.";

export async function loadMoreCategoryProducts(
  categoryId: string,
  cursor?: string,
): Promise<LoadMoreCategoryProductsResult> {
  const page = await fetchCategoryProductsPage(categoryId, cursor);
  if (!page) {
    return { items: [], nextCursor: cursor ?? null, error: PRODUCTS_FETCH_ERROR };
  }

  const items = await Promise.all(page.items.map(resolveProductCardData));
  return { items, nextCursor: page.next_cursor, error: null };
}
