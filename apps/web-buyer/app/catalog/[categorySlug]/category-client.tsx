'use client';

import { useState, useTransition } from 'react';
import { Breadcrumb, EmptyState, ErrorPanel, ProductCard } from '@longrich/ui-kit';
import type { BreadcrumbItem } from '@longrich/ui-kit';
import type { CategoryProductCardData } from './catalog-data';
import { loadMoreCategoryProducts } from './actions';
import styles from './category.module.css';

export interface CategoryClientProps {
  categoryId: string;
  categoryName: string;
  breadcrumbItems: BreadcrumbItem[];
  initialProducts: CategoryProductCardData[];
  initialNextCursor: string | null;
  initialError: string | null;
}

export function CategoryClient({
  categoryId,
  categoryName,
  breadcrumbItems,
  initialProducts,
  initialNextCursor,
  initialError,
}: CategoryClientProps) {
  const [products, setProducts] = useState(initialProducts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [error, setError] = useState(initialError);
  const [isPending, startTransition] = useTransition();

  function handleLoadMoreOrRetry() {
    const cursor = nextCursor ?? undefined;
    const mode: 'replace' | 'append' = products.length === 0 ? 'replace' : 'append';

    startTransition(async () => {
      const result = await loadMoreCategoryProducts(categoryId, cursor);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setProducts((prev) => (mode === 'replace' ? result.items : [...prev, ...result.items]));
      setNextCursor(result.nextCursor);
    });
  }

  return (
    <>
      <div className={styles.breadcrumbWrapper}>
        <Breadcrumb items={breadcrumbItems} />
      </div>
      <h2 className={styles.heading}>{categoryName}</h2>

      {products.length === 0 ? (
        error ? (
          <ErrorPanel message={error} onRetry={handleLoadMoreOrRetry} />
        ) : (
          <EmptyState
            title="Mahsulot topilmadi"
            description="Ushbu kategoriyada hozircha nashr qilingan mahsulot yo'q."
          />
        )
      ) : (
        <>
          <div className={styles.productGrid}>
            {products.map((product) => (
              <ProductCard
                key={product.id}
                id={product.id}
                title={product.title}
                href={product.href}
                coverImageUrl={product.coverImageUrl}
                priceMinor={product.priceMinor}
                currency={product.currency}
              />
            ))}
          </div>

          {error && (
            <div className={styles.errorWrapper}>
              <ErrorPanel message={error} onRetry={handleLoadMoreOrRetry} />
            </div>
          )}

          {!error && nextCursor && (
            <div className={styles.loadMoreWrapper}>
              <button
                type="button"
                className={styles.loadMoreButton}
                onClick={handleLoadMoreOrRetry}
                disabled={isPending}
              >
                {isPending ? 'Yuklanmoqda...' : 'Yana yuklash'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
