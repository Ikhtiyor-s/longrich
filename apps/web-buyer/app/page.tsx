import type { CategoryDto, ProductDetailDto, ProductListItemDto, PublicOfferDto } from '@longrich/shared-types';
import { HomeClient } from './home-client';
import type { FetchResult, ProductCardViewModel } from './home-client';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3999';

interface ApiEnvelope<T> {
  data: T;
}

interface CursorPageBody<T> {
  items: T[];
}

async function getCategories(): Promise<FetchResult<CategoryDto[]>> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/categories?limit=100`, { cache: 'no-store' });
    if (!res.ok) return { status: 'error' };
    const body = (await res.json()) as ApiEnvelope<CursorPageBody<CategoryDto>>;
    return { status: 'ok', data: body.data.items };
  } catch {
    return { status: 'error' };
  }
}

async function getProducts(): Promise<FetchResult<ProductListItemDto[]>> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/products?limit=24`, { cache: 'no-store' });
    if (!res.ok) return { status: 'error' };
    const body = (await res.json()) as ApiEnvelope<CursorPageBody<ProductListItemDto>>;
    return { status: 'ok', data: body.data.items };
  } catch {
    return { status: 'error' };
  }
}

async function getLowestOfferForVariant(variantId: string): Promise<{ priceMinor: string; currency: string } | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/variants/${variantId}/offers`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as ApiEnvelope<CursorPageBody<PublicOfferDto>>;
    const firstOffer = body.data.items[0];
    return firstOffer ? { priceMinor: firstOffer.price_minor, currency: firstOffer.currency } : null;
  } catch {
    return null;
  }
}

async function getLowestPriceForProduct(productId: string): Promise<{ priceMinor: string; currency: string } | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/products/${productId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as ApiEnvelope<ProductDetailDto>;
    for (const variant of body.data.variants) {
      const offer = await getLowestOfferForVariant(variant.id);
      if (offer) return offer;
    }
    return null;
  } catch {
    return null;
  }
}

async function buildProductCardViewModels(products: ProductListItemDto[]): Promise<ProductCardViewModel[]> {
  return Promise.all(
    products.map(async (product) => {
      const offer = await getLowestPriceForProduct(product.id);
      return {
        id: product.id,
        title: product.title,
        priceMinor: offer?.priceMinor ?? null,
        currency: offer?.currency,
        coverImageUrl: null,
      };
    }),
  );
}

export default async function Home() {
  const [categoriesResult, productsResult] = await Promise.all([getCategories(), getProducts()]);

  const categories: FetchResult<CategoryDto[]> =
    categoriesResult.status === 'ok'
      ? { status: 'ok', data: categoriesResult.data.filter((category) => category.parent_id !== null) }
      : categoriesResult;

  const products: FetchResult<ProductCardViewModel[]> =
    productsResult.status === 'ok'
      ? { status: 'ok', data: await buildProductCardViewModels(productsResult.data) }
      : productsResult;

  return <HomeClient categories={categories} products={products} />;
}
