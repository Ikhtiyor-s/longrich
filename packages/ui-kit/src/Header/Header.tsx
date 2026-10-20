'use client';

import Link from 'next/link';
import {
  CartIcon,
  ChevronDownIcon,
  GlobeIcon,
  GridIcon,
  HeartIcon,
  MapPinIcon,
  UserIcon,
} from '../icons/index.js';
import { SoftDisabledButton } from '../internal/SoftDisabledButton.js';
import { SearchCombobox } from '../SearchCombobox/SearchCombobox.js';
import type { SearchComboboxProps } from '../SearchCombobox/SearchCombobox.js';
import styles from './Header.module.css';

export interface HeaderProps {
  categoriesHref?: string;
  search: SearchComboboxProps;
  deliveryLabel?: string | null;
  language?: { code: 'uz' | 'ru'; label: string };
  cartCount?: number;
  onFavoritesActivate?: () => void;
  onAccountActivate?: () => void;
  onCartActivate?: () => void;
  onDeliveryActivate?: () => void;
  onLanguageActivate?: () => void;
}

export function Header({
  categoriesHref = '/#categories',
  search,
  deliveryLabel = null,
  language = { code: 'uz', label: 'UZ' },
  cartCount,
  onFavoritesActivate,
  onAccountActivate,
  onCartActivate,
  onDeliveryActivate,
  onLanguageActivate,
}: HeaderProps) {
  const showCartBadge = typeof cartCount === 'number' && cartCount > 0;
  const cartAriaLabel = showCartBadge
    ? `Savat — ${cartCount} mahsulot — tez orada`
    : 'Savat — tez orada';
  const cartToastMessage = "Savat G4 bosqichida qo'shiladi";

  const cartGlyph = (
    <span className={styles.cartIconWrapper}>
      <CartIcon size={24} />
      {showCartBadge ? <span className={styles.cartBadge}>{cartCount}</span> : null}
    </span>
  );

  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <nav className={styles.primaryNav} aria-label="Asosiy navigatsiya">
            <Link href="/" className={styles.wordmark}>
              <span className={styles.wordmarkPrimary}>LONGRICH</span>
              <span className={styles.wordmarkSecondary}>Marketplace</span>
            </Link>

            <Link href={categoriesHref} className={styles.categoriesLink}>
              <GridIcon size={20} />
              <span>Barcha kategoriyalar</span>
            </Link>
          </nav>

          <div className={styles.searchSlot}>
            <SearchCombobox {...search} />
          </div>

          <div className={styles.iconGroup}>
            <SoftDisabledButton
              ariaLabel="Yetkazib berish manzilini tanlash — tez orada"
              toastMessage="Tez orada"
              onActivate={onDeliveryActivate}
              className={`${styles.pillButton} ${styles.deliveryButton}`}
            >
              <MapPinIcon size={18} />
              <span className={styles.deliveryLabel}>
                {deliveryLabel ?? 'Yetkazib berish manzili'}
              </span>
            </SoftDisabledButton>

            <SoftDisabledButton
              ariaLabel="Tilni tanlash — tez orada"
              toastMessage="Tez orada"
              onActivate={onLanguageActivate}
              className={styles.pillButton}
            >
              <GlobeIcon size={18} />
              <span className={styles.languageLabel}>{language.label}</span>
              <ChevronDownIcon size={14} />
            </SoftDisabledButton>

            <SoftDisabledButton
              ariaLabel="Sevimlilar — tez orada"
              toastMessage="Tez orada"
              onActivate={onFavoritesActivate}
              className={styles.iconButton}
            >
              <HeartIcon size={24} />
            </SoftDisabledButton>

            <SoftDisabledButton
              ariaLabel="Kabinet — tez orada"
              toastMessage="Tez orada"
              onActivate={onAccountActivate}
              className={styles.iconButton}
            >
              <UserIcon size={24} />
            </SoftDisabledButton>

            <SoftDisabledButton
              ariaLabel={cartAriaLabel}
              toastMessage={cartToastMessage}
              onActivate={onCartActivate}
              className={styles.iconButton}
            >
              {cartGlyph}
            </SoftDisabledButton>
          </div>
        </div>
      </header>

      <div className={styles.mobileBar}>
        <Link href="/" className={styles.mobileWordmark} aria-label="LONGRICH Marketplace — bosh sahifa">
          LONGRICH
        </Link>

        <div className={styles.mobileSearchSlot}>
          <SearchCombobox {...search} />
        </div>

        <SoftDisabledButton
          ariaLabel={cartAriaLabel}
          toastMessage={cartToastMessage}
          onActivate={onCartActivate}
          className={styles.mobileCartButton}
        >
          {cartGlyph}
        </SoftDisabledButton>
      </div>
    </>
  );
}
