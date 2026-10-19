import { HomeClient } from './home-client';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3999';

interface Category {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
}

interface ProductListItem {
  id: string;
  title: string;
  category_id: string;
}

interface Offer {
  price_minor: string;
  currency: string;
}

interface ProductWithPrice {
  id: string;
  title: string;
  price: string | null;
}

async function getCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE_URL}/v1/catalog/categories?limit=100`, { cache: 'no-store' });
  if (!res.ok) return [];
  const body = await res.json();
  return body.data.items as Category[];
}

async function getProducts(): Promise<ProductListItem[]> {
  const res = await fetch(`${API_BASE_URL}/v1/catalog/products?limit=24`, { cache: 'no-store' });
  if (!res.ok) return [];
  const body = await res.json();
  return body.data.items as ProductListItem[];
}

async function getLowestPrice(productId: string): Promise<string | null> {
  const detailRes = await fetch(`${API_BASE_URL}/v1/catalog/products/${productId}`, { cache: 'no-store' });
  if (!detailRes.ok) return null;
  const detail = await detailRes.json();
  const variants = detail.data.variants as Array<{ id: string }>;
  for (const variant of variants) {
    const offersRes = await fetch(`${API_BASE_URL}/v1/catalog/variants/${variant.id}/offers`, { cache: 'no-store' });
    if (!offersRes.ok) continue;
    const offersBody = await offersRes.json();
    const offers = offersBody.data.items as Offer[];
    const firstOffer = offers[0];
    if (firstOffer) {
      const minorToSom = Math.round(Number(firstOffer.price_minor) / 100);
      return `${minorToSom.toLocaleString('ru-RU')} so'm`;
    }
  }
  return null;
}

export default async function Home() {
  const [categories, products] = await Promise.all([getCategories(), getProducts()]);
  const productsWithPrice: ProductWithPrice[] = await Promise.all(
    products.map(async (p) => ({ id: p.id, title: p.title, price: await getLowestPrice(p.id) })),
  );
  const subcategories = categories.filter((c) => c.parent_id !== null);

  return <HomeClient categories={subcategories} products={productsWithPrice} />;
}
