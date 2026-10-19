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

interface ProductWithPrice extends ProductListItem {
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

function formatCategoryTree(categories: Category[]): Category[] {
  return categories.filter((c) => c.parent_id !== null);
}

export default async function Home() {
  const [categories, products] = await Promise.all([getCategories(), getProducts()]);
  const productsWithPrice: ProductWithPrice[] = await Promise.all(
    products.map(async (p) => ({ ...p, price: await getLowestPrice(p.id) })),
  );
  const subcategories = formatCategoryTree(categories);

  return (
    <main style={{ fontFamily: 'Inter, Manrope, system-ui, sans-serif', background: '#F7F9F8', minHeight: '100vh' }}>
      <header
        style={{
          background: '#FFFFFF',
          borderBottom: '1px solid #E2EAE6',
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <span style={{ fontSize: 22, fontWeight: 700, color: '#087E65' }}>LONGRICH</span>
        <span style={{ fontSize: 14, color: '#61717A' }}>Marketplace</span>
      </header>

      <section style={{ padding: '32px' }}>
        <h1 style={{ fontSize: 28, color: '#17252A', marginBottom: 8 }}>Kategoriyalar</h1>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 40 }}>
          {subcategories.length === 0 && <p style={{ color: '#61717A' }}>Kategoriyalar topilmadi.</p>}
          {subcategories.map((c) => (
            <span
              key={c.id}
              style={{
                background: '#E4F5EF',
                color: '#066951',
                padding: '8px 16px',
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {c.name}
            </span>
          ))}
        </div>

        <h2 style={{ fontSize: 22, color: '#17252A', marginBottom: 16 }}>Mahsulotlar</h2>
        {productsWithPrice.length === 0 && <p style={{ color: '#61717A' }}>Hozircha nashr qilingan mahsulot yo&apos;q.</p>}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 20,
          }}
        >
          {productsWithPrice.map((p) => (
            <div
              key={p.id}
              style={{
                background: '#FFFFFF',
                border: '1px solid #E2EAE6',
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  background: '#F0F5F3',
                  borderRadius: 10,
                  marginBottom: 12,
                }}
              />
              <p style={{ fontSize: 15, fontWeight: 600, color: '#17252A', marginBottom: 8, lineHeight: 1.3 }}>
                {p.title}
              </p>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#087E65' }}>{p.price ?? 'Narx mavjud emas'}</p>
            </div>
          ))}
        </div>
      </section>

      <footer style={{ padding: '24px 32px', color: '#61717A', fontSize: 13 }}>
        G2 milestone demo — real catalog data from{' '}
        <code style={{ background: '#F0F5F3', padding: '2px 6px', borderRadius: 4 }}>{API_BASE_URL}</code>. Cart,
        checkout, auth UI and full design system land in later milestones (G4, G7).
      </footer>
    </main>
  );
}
