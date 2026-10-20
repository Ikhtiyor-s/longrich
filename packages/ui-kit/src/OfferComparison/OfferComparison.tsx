'use client';

import { useEffect, useState } from 'react';
import type { PublicOfferDto } from '@longrich/shared-types';
import { ErrorPanel } from '../ErrorPanel/ErrorPanel.js';
import { Skeleton } from '../Skeleton/Skeleton.js';
import { PriceBlock } from '../PriceBlock/PriceBlock.js';
import styles from './OfferComparison.module.css';

export interface OfferComparisonProps {
  offers: PublicOfferDto[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onAddToCartActivate?: (offerId: string) => void;
}

const CART_LABEL = "Savat G4 bosqichida qo'shiladi";
const TOAST_DURATION_MS = 3000;

function sortByPriceAscending(offers: PublicOfferDto[]): PublicOfferDto[] {
  return [...offers].sort((a, b) => {
    const diff = BigInt(a.price_minor) - BigInt(b.price_minor);
    if (diff < 0n) return -1;
    if (diff > 0n) return 1;
    return 0;
  });
}

export function OfferComparison({ offers, isLoading, error, onRetry, onAddToCartActivate }: OfferComparisonProps) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (isLoading) {
    return <Skeleton variant="offer-row" count={2} />;
  }

  if (error) {
    return <ErrorPanel message={error} onRetry={onRetry} />;
  }

  if (offers.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Hozircha taklif yo&apos;q</p>
        <button type="button" className={styles.softDisabled} aria-disabled="true" aria-label="Savatga qo'shish — tez orada">
          Savatga qo&apos;shish
        </button>
      </div>
    );
  }

  function activateCart(offerId: string) {
    onAddToCartActivate?.(offerId);
    setToast(CART_LABEL);
  }

  const sorted = sortByPriceAscending(offers);

  return (
    <div className={styles.list}>
      {sorted.map((offer) => (
        <div key={offer.id} className={styles.row}>
          <span className={styles.seller}>{offer.seller_name}</span>
          <PriceBlock priceMinor={offer.price_minor} size="sm" />
          <span className={styles.fulfillment}>{offer.fulfillment_mode}</span>
          <button
            type="button"
            className={styles.softDisabled}
            aria-disabled="true"
            aria-label={CART_LABEL}
            title={CART_LABEL}
            onClick={() => activateCart(offer.id)}
          >
            Savatga qo&apos;shish
          </button>
        </div>
      ))}
      {toast && (
        <div role="status" aria-live="polite" className={styles.toast}>
          {toast}
        </div>
      )}
    </div>
  );
}
