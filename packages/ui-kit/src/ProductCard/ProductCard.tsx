'use client';

import { useEffect, useState } from 'react';
import { PriceBlock } from '../PriceBlock/PriceBlock.js';
import { HeartIcon, CartIcon } from '../icons/index.js';
import styles from './ProductCard.module.css';

export interface ProductCardProps {
  id: string;
  title: string;
  href: string;

  coverImageUrl?: string | null;
  priceMinor?: string | null;
  currency?: string;

  rating?: { average: number; verifiedCount: number } | null;
  sellerName?: string | null;
  stockLabel?: string | null;
  deliveryLabel?: string | null;

  onFavoriteActivate?: () => void;
  onAddToCartActivate?: () => void;
}

const FAVORITE_LABEL = "Sevimlilarga qo'shish — tez orada";
const CART_LABEL_AVAILABLE = "Savat G4 bosqichida qo'shiladi";
const CART_LABEL_NO_PRICE = 'Narx mavjud emas';
const TOAST_DURATION_MS = 3000;

export function ProductCard({
  title,
  href,
  coverImageUrl,
  priceMinor,
  onFavoriteActivate,
  onAddToCartActivate,
}: ProductCardProps) {
  const hasPrice = priceMinor != null;
  const cartLabel = hasPrice ? CART_LABEL_AVAILABLE : CART_LABEL_NO_PRICE;
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  function activateFavorite() {
    onFavoriteActivate?.();
    setToast(FAVORITE_LABEL);
  }

  function activateCart() {
    onAddToCartActivate?.();
    setToast(cartLabel);
  }

  return (
    <article className={styles.card}>
      <a href={href} aria-label={title} className={styles.mediaLink}>
        {coverImageUrl ? (
          <img src={coverImageUrl} alt={title} className={styles.image} width={400} height={400} />
        ) : (
          <div className={styles.imagePlaceholder} aria-hidden="true" />
        )}
      </a>
      <div className={styles.body}>
        <a href={href} className={styles.title}>
          {title}
        </a>
        <PriceBlock priceMinor={priceMinor ?? null} size="sm" />
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.softDisabled}
          aria-disabled="true"
          aria-label={FAVORITE_LABEL}
          title={FAVORITE_LABEL}
          onClick={activateFavorite}
        >
          <HeartIcon size={20} />
        </button>
        <button
          type="button"
          className={styles.softDisabled}
          aria-disabled="true"
          aria-label={cartLabel}
          title={cartLabel}
          onClick={activateCart}
        >
          <CartIcon size={20} />
          <span className={styles.actionMicroLabel}>{cartLabel}</span>
        </button>
      </div>
      {toast && (
        <div role="status" aria-live="polite" className={styles.toast}>
          {toast}
        </div>
      )}
    </article>
  );
}
