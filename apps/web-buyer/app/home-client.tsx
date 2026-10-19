'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

interface ProductWithPrice {
  id: string;
  title: string;
  price: string | null;
}

const QUICK_ACCESS: Array<{ label: string; icon: string; href?: string }> = [
  { label: 'Kategoriyalar', icon: '▓', href: '#categories' },
  { label: 'Aksiyalar', icon: '♦' },
  { label: 'Skaner', icon: '⌗' },
  { label: 'Yangi', icon: '✦' },
  { label: 'Yetkazib berish', icon: '➤' },
  { label: 'Brendlar', icon: '◈' },
];

function NavIconButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      title={`${label} — tez orada`}
      disabled
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        border: '1px solid var(--divider)',
        background: 'var(--surface)',
        color: 'var(--text-secondary)',
        cursor: 'not-allowed',
        fontSize: 16,
      }}
    >
      {label[0]}
    </button>
  );
}

export function HomeClient({ categories, products }: { categories: Category[]; products: ProductWithPrice[] }) {
  const [query, setQuery] = useState('');

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.title.toLowerCase().includes(q));
  }, [query, products]);

  return (
    <>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          height: 'var(--nav-height)',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--divider)',
        }}
      >
        <div
          style={{
            maxWidth: 'var(--content-max)',
            margin: '0 auto',
            height: '100%',
            padding: '0 var(--space-6)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-5)',
          }}
        >
          <Link href="/" style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', textDecoration: 'none' }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)', letterSpacing: '-0.02em' }}>
              LONGRICH
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Marketplace</span>
          </Link>

          <a
            href="#categories"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Barcha kategoriyalar
          </a>

          <div style={{ flex: 1, maxWidth: 560 }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Mahsulot qidirish..."
              style={{
                width: '100%',
                height: 40,
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--divider)',
                background: 'var(--surface-alt)',
                padding: '0 var(--space-4)',
                fontSize: 14,
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
          </div>

          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              border: '1px solid var(--divider)',
              borderRadius: 999,
              padding: '4px 10px',
            }}
          >
            UZ
          </span>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <NavIconButton label="Sevimlilar" />
            <NavIconButton label="Kabinet" />
            <NavIconButton label="Savat" />
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 'var(--content-max)', margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gap: 'var(--space-6)',
            marginBottom: 'var(--space-8)',
          }}
        >
          <div
            style={{
              background: 'var(--secondary)',
              color: '#fff',
              borderRadius: 'var(--radius-card)',
              padding: 'var(--space-8)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 'var(--space-4)',
            }}
          >
            <h1 style={{ fontSize: 34, lineHeight: 1.2, margin: 0 }}>
              Oʻzbekiston uchun universal marketplace
            </h1>
            <p style={{ fontSize: 15, color: '#cfe6df', margin: 0, maxWidth: 480 }}>
              Bir nechta sotuvchidan bitta savatchada xarid qiling — haqiqiy katalog, haqiqiy takliflar.
            </p>
            <a
              href="#categories"
              style={{
                display: 'inline-block',
                background: 'var(--primary)',
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
                padding: '12px 24px',
                borderRadius: 'var(--radius-button)',
                textDecoration: 'none',
                width: 'fit-content',
              }}
            >
              Katalogni ko&apos;rish
            </a>
          </div>

          <div
            style={{
              background: 'var(--primary-soft)',
              borderRadius: 'var(--radius-card)',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary-hover)' }}>Hozirda platformada</span>
            <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--secondary)' }}>{categories.length}</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>kategoriya</span>
            <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--secondary)', marginTop: 'var(--space-2)' }}>
              {products.length}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>nashr qilingan mahsulot</span>
          </div>
        </section>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-8)',
          }}
        >
          {QUICK_ACCESS.map((item) => (
            <a
              key={item.label}
              href={item.href ?? undefined}
              title={item.href ? undefined : `${item.label} — tez orada`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-card)',
                background: 'var(--surface)',
                border: '1px solid var(--divider)',
                textDecoration: 'none',
                color: item.href ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: item.href ? 'pointer' : 'default',
                opacity: item.href ? 1 : 0.6,
              }}
            >
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>{item.label}</span>
            </a>
          ))}
        </section>

        <section id="categories" style={{ marginBottom: 'var(--space-8)', scrollMarginTop: 'calc(var(--nav-height) + 16px)' }}>
          <h2 style={{ fontSize: 22, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>Kategoriyalar</h2>
          {categories.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>Kategoriyalar topilmadi.</p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: 'var(--space-4)',
              }}
            >
              {categories.map((c) => (
                <div
                  key={c.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--divider)',
                    borderRadius: 'var(--radius-card)',
                    padding: 'var(--space-4)',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      background: 'var(--surface-alt)',
                      borderRadius: 'var(--radius-input)',
                      marginBottom: 'var(--space-2)',
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 style={{ fontSize: 22, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
            Mahsulotlar{query ? ` — "${query}" bo'yicha` : ''}
          </h2>
          {filteredProducts.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>
              {query ? 'Hech narsa topilmadi.' : "Hozircha nashr qilingan mahsulot yo'q."}
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 'var(--space-5)',
              }}
            >
              {filteredProducts.map((p) => (
                <article
                  key={p.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--divider)',
                    borderRadius: 'var(--radius-card)',
                    padding: 'var(--space-5)',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      background: 'var(--surface-alt)',
                      borderRadius: 'var(--radius-input)',
                      marginBottom: 'var(--space-3)',
                    }}
                  />
                  <p
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      marginBottom: 'var(--space-2)',
                      lineHeight: 1.3,
                      minHeight: 39,
                    }}
                  >
                    {p.title}
                  </p>
                  <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--primary)', margin: 0 }}>
                    {p.price ?? 'Narx mavjud emas'}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
        G2 milestone demo — savat, checkout va kirish ekrani G4/G7 bosqichlarida qo&apos;shiladi.
      </footer>
    </>
  );
}
