'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Breadcrumb, EmptyState, ErrorPanel, OfferComparison } from '@longrich/ui-kit';
import type { BreadcrumbItem } from '@longrich/ui-kit';
import type { ProductDetailDto, ProductVariantDto, PublicOfferDto } from '@longrich/shared-types';
import { loadVariantOffers } from './actions';
import styles from './product.module.css';

export type ProductDetailViewResult =
  | {
      status: 'ok';
      product: ProductDetailDto;
      breadcrumbItems: BreadcrumbItem[];
      initialVariantId: string | null;
      initialOffers: PublicOfferDto[];
      initialOffersError: string | null;
    }
  | { status: 'not-found' }
  | { status: 'error' };

export interface ProductClientProps {
  result: ProductDetailViewResult;
}

type TabKey = 'description' | 'attributes' | 'stores';

const TAB_ITEMS: Array<{ key: TabKey; label: string }> = [
  { key: 'description', label: 'Tavsif' },
  { key: 'attributes', label: 'Xususiyatlar' },
  { key: 'stores', label: "Do'konlar" },
];

const CART_ARIA_LABEL = "Savatga qo'shish — tez orada";
const CART_MICRO_LABEL = "Savat G4 bosqichida qo'shiladi";
const TOAST_DURATION_MS = 3000;
const PRODUCT_FETCH_ERROR = "Mahsulotni yuklashda xatolik yuz berdi. Keyinroq qayta urinib ko'ring.";

interface OffersCacheEntry {
  offers: PublicOfferDto[];
  error: string | null;
}

function formatVariantLabel(variant: ProductVariantDto): string {
  const entries = Object.entries(variant.options);
  if (entries.length === 0) {
    return variant.id;
  }
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

function ProductNotFound() {
  return (
    <EmptyState
      title="Mahsulot topilmadi"
      description="Ushbu mahsulot mavjud emas yoki hali e'lon qilinmagan."
      action={{ label: 'Bosh sahifaga qaytish', href: '/' }}
    />
  );
}

function ProductFetchError() {
  const router = useRouter();
  return <ErrorPanel message={PRODUCT_FETCH_ERROR} onRetry={() => router.refresh()} />;
}

export function ProductClient({ result }: ProductClientProps) {
  if (result.status === 'not-found') {
    return <ProductNotFound />;
  }

  if (result.status === 'error') {
    return <ProductFetchError />;
  }

  return <ProductDetailView {...result} />;
}

function ProductDetailView({
  product,
  breadcrumbItems,
  initialVariantId,
  initialOffers,
  initialOffersError,
}: {
  product: ProductDetailDto;
  breadcrumbItems: BreadcrumbItem[];
  initialVariantId: string | null;
  initialOffers: PublicOfferDto[];
  initialOffersError: string | null;
}) {
  const [selectedVariantId, setSelectedVariantId] = useState(initialVariantId);
  const [offersCache, setOffersCache] = useState<Record<string, OffersCacheEntry>>(
    initialVariantId ? { [initialVariantId]: { offers: initialOffers, error: initialOffersError } } : {},
  );
  const [pendingVariantId, setPendingVariantId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<TabKey>('description');
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [cartToast, setCartToast] = useState<string | null>(null);
  const tabListId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!cartToast) {
      return;
    }
    const timer = setTimeout(() => setCartToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [cartToast]);

  const selectedVariant = product.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const offersEntry = selectedVariantId ? offersCache[selectedVariantId] : undefined;
  const isOffersLoading = pendingVariantId !== null && pendingVariantId === selectedVariantId;

  function ensureOffers(variantId: string) {
    setPendingVariantId(variantId);
    startTransition(async () => {
      const loadResult = await loadVariantOffers(variantId);
      setOffersCache((prev) => ({
        ...prev,
        [variantId]: { offers: loadResult.offers, error: loadResult.error },
      }));
      setPendingVariantId((current) => (current === variantId ? null : current));
    });
  }

  function handleSelectVariant(variantId: string) {
    setSelectedVariantId(variantId);
    if (!offersCache[variantId]) {
      ensureOffers(variantId);
    }
  }

  function handleRetryOffers() {
    if (!selectedVariantId) {
      return;
    }
    ensureOffers(selectedVariantId);
  }

  function activateCart() {
    setCartToast(CART_MICRO_LABEL);
  }

  function focusTab(index: number) {
    const item = TAB_ITEMS[index];
    if (!item) {
      return;
    }
    setActiveTab(item.key);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusTab((index + 1) % TAB_ITEMS.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusTab((index - 1 + TAB_ITEMS.length) % TAB_ITEMS.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(TAB_ITEMS.length - 1);
    }
  }

  return (
    <>
      <div className={styles.breadcrumbWrapper}>
        <Breadcrumb items={breadcrumbItems} />
      </div>

      <div className={styles.mediaBlock}>
        <div className={styles.cover} aria-hidden="true" />
        {product.media.length > 1 && (
          <div className={styles.thumbStrip} role="group" aria-label="Mahsulot rasmlari">
            {product.media.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={index === selectedMediaIndex}
                aria-label={`${index + 1}-rasm`}
                className={index === selectedMediaIndex ? `${styles.thumb} ${styles.thumbActive}` : styles.thumb}
                onClick={() => setSelectedMediaIndex(index)}
              />
            ))}
          </div>
        )}
      </div>

      {product.brand && <p className={styles.eyebrow}>{product.brand.name}</p>}
      <h1 className={styles.title}>{product.title}</h1>

      {product.variants.length > 1 && (
        <div className={styles.variantGroup} role="group" aria-label="Variant tanlash">
          {product.variants.map((variant) => (
            <button
              key={variant.id}
              type="button"
              aria-pressed={variant.id === selectedVariantId}
              className={
                variant.id === selectedVariantId
                  ? `${styles.variantButton} ${styles.variantButtonActive}`
                  : styles.variantButton
              }
              onClick={() => handleSelectVariant(variant.id)}
            >
              {formatVariantLabel(variant)}
            </button>
          ))}
        </div>
      )}

      <div className={styles.tabsWrapper}>
        <div role="tablist" aria-label="Mahsulot ma'lumotlari" className={styles.tabList}>
          {TAB_ITEMS.map((item, index) => (
            <button
              key={item.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${tabListId}-tab-${item.key}`}
              aria-selected={activeTab === item.key}
              aria-controls={`${tabListId}-panel-${item.key}`}
              tabIndex={activeTab === item.key ? 0 : -1}
              className={activeTab === item.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setActiveTab(item.key)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`${tabListId}-panel-description`}
          aria-labelledby={`${tabListId}-tab-description`}
          hidden={activeTab !== 'description'}
          tabIndex={0}
          className={styles.tabPanel}
        >
          <p className={styles.description}>{product.description || 'Tavsif mavjud emas.'}</p>
        </div>

        <div
          role="tabpanel"
          id={`${tabListId}-panel-attributes`}
          aria-labelledby={`${tabListId}-tab-attributes`}
          hidden={activeTab !== 'attributes'}
          tabIndex={0}
          className={styles.tabPanel}
        >
          {selectedVariant && selectedVariant.attribute_values.length > 0 ? (
            <dl className={styles.attributeList}>
              {selectedVariant.attribute_values.map((attribute) => (
                <div key={attribute.category_attribute_id} className={styles.attributeRow}>
                  <dt className={styles.attributeKey}>{attribute.key}</dt>
                  <dd className={styles.attributeValue}>{String(attribute.value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={styles.description}>Xususiyatlar ko&apos;rsatilmagan.</p>
          )}
        </div>

        <div
          role="tabpanel"
          id={`${tabListId}-panel-stores`}
          aria-labelledby={`${tabListId}-tab-stores`}
          hidden={activeTab !== 'stores'}
          tabIndex={0}
          className={styles.tabPanel}
        >
          {selectedVariant ? (
            <OfferComparison
              offers={offersEntry?.offers ?? []}
              isLoading={isOffersLoading}
              error={offersEntry?.error ?? null}
              onRetry={handleRetryOffers}
              onAddToCartActivate={activateCart}
            />
          ) : (
            <EmptyState title="Variantlar mavjud emas" />
          )}
        </div>
      </div>

      <div className={styles.ctaRow}>
        <button
          type="button"
          aria-disabled="true"
          aria-label={CART_ARIA_LABEL}
          title={CART_MICRO_LABEL}
          className={styles.primaryCta}
          onClick={activateCart}
        >
          Savatga qo&apos;shish
          <span className={styles.ctaMicroLabel}>{CART_MICRO_LABEL}</span>
        </button>
        {cartToast && (
          <div role="status" aria-live="polite" className={styles.toast}>
            {cartToast}
          </div>
        )}
      </div>
    </>
  );
}
