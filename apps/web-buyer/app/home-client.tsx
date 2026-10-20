'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CategoryTile, ProductCard, EmptyState, ErrorPanel } from '@longrich/ui-kit';
import type { CategoryDto } from '@longrich/shared-types';
import styles from './home-client.module.css';

export interface ProductCardViewModel {
  id: string;
  title: string;
  priceMinor: string | null;
  currency?: string;
  coverImageUrl?: string | null;
}

export type FetchResult<T> = { status: 'ok'; data: T } | { status: 'error' };

export interface HomeClientProps {
  categories: FetchResult<CategoryDto[]>;
  products: FetchResult<ProductCardViewModel[]>;
}

const QUICK_ACCESS_SOFT_DISABLED_ITEMS = [
  { key: 'deals', label: 'Aksiyalar' },
  { key: 'scanner', label: 'Skaner' },
  { key: 'new', label: 'Yangi' },
  { key: 'delivery', label: 'Yetkazib berish' },
  { key: 'brands', label: 'Brendlar' },
] as const;

const SOFT_DISABLED_TOAST_MESSAGE = 'Tez orada';
const TOAST_DURATION_MS = 3000;

function QuickAccessSoftButton({ label }: { label: string }) {
  const [toastVisible, setToastVisible] = useState(false);

  function activate() {
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), TOAST_DURATION_MS);
  }

  return (
    <span className={styles.quickAccessWrapper}>
      <button
        type="button"
        aria-disabled="true"
        aria-label={`${label} — tez orada`}
        title={SOFT_DISABLED_TOAST_MESSAGE}
        className={styles.quickAccessItem}
        onClick={activate}
      >
        {label}
      </button>
      {toastVisible && (
        <span role="status" aria-live="polite" className={styles.toast}>
          {SOFT_DISABLED_TOAST_MESSAGE}
        </span>
      )}
    </span>
  );
}

function HeroSection() {
  return (
    <section className={styles.hero}>
      <h1 className={styles.heroTitle}>O‘zbekiston uchun universal marketplace</h1>
      <p className={styles.heroSubcopy}>
        Bir nechta sotuvchidan bitta savatchada xarid qiling — haqiqiy katalog, haqiqiy takliflar.
      </p>
      <a href="#categories" className={styles.heroCta}>
        Katalogni ko‘rish
      </a>
    </section>
  );
}

function QuickAccessRow() {
  return (
    <section className={styles.quickAccess} aria-label="Tezkor havolalar">
      <a href="#categories" className={styles.quickAccessItem}>
        Kategoriyalar
      </a>
      {QUICK_ACCESS_SOFT_DISABLED_ITEMS.map((item) => (
        <QuickAccessSoftButton key={item.key} label={item.label} />
      ))}
    </section>
  );
}

function RetryErrorPanel() {
  const router = useRouter();
  return <ErrorPanel onRetry={() => router.refresh()} />;
}

function CategoriesSection({ categories }: { categories: FetchResult<CategoryDto[]> }) {
  return (
    <section id="categories" className={styles.section}>
      <h2 className={styles.sectionTitle}>Kategoriyalar</h2>
      {categories.status === 'error' ? (
        <RetryErrorPanel />
      ) : categories.data.length === 0 ? (
        <EmptyState title="Kategoriyalar topilmadi" />
      ) : (
        <div className={styles.categoryGrid}>
          {categories.data.map((category) => (
            <CategoryTile
              key={category.id}
              id={category.id}
              slug={category.slug}
              name={category.name}
              href={`/catalog/${category.slug}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProductsSection({ products }: { products: FetchResult<ProductCardViewModel[]> }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Barcha mahsulotlar</h2>
      {products.status === 'error' ? (
        <RetryErrorPanel />
      ) : products.data.length === 0 ? (
        <EmptyState title="Hozircha nashr qilingan mahsulot yo'q" />
      ) : (
        <div className={styles.productGrid}>
          {products.data.map((product) => (
            <ProductCard
              key={product.id}
              id={product.id}
              title={product.title}
              href={`/product/${product.id}`}
              coverImageUrl={product.coverImageUrl}
              priceMinor={product.priceMinor}
              currency={product.currency}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function HomeClient({ categories, products }: HomeClientProps) {
  return (
    <>
      <HeroSection />
      <QuickAccessRow />
      <CategoriesSection categories={categories} />
      <ProductsSection products={products} />
    </>
  );
}
