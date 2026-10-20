'use client';

import Link from 'next/link';
import { GridIcon, HeartIcon, HomeIcon, ScanIcon, UserIcon } from '../icons/index.js';
import { SoftDisabledButton } from '../internal/SoftDisabledButton.js';
import styles from './MobileNav.module.css';

export interface MobileNavProps {
  activeItem?: 'home' | 'categories' | 'scan-search' | 'favorites' | 'profile';
  onScanSearchActivate?: () => void;
  onFavoritesActivate?: () => void;
  onProfileActivate?: () => void;
}

export function MobileNav({
  activeItem,
  onScanSearchActivate,
  onFavoritesActivate,
  onProfileActivate,
}: MobileNavProps) {
  return (
    <nav className={styles.nav} aria-label="Mobil navigatsiya">
      <Link
        href="/"
        className={`${styles.item} ${styles.link}`}
        aria-current={activeItem === 'home' ? 'page' : undefined}
      >
        <HomeIcon size={20} />
        <span className={styles.label}>Bosh sahifa</span>
      </Link>

      <Link
        href="/#categories"
        className={`${styles.item} ${styles.link}`}
        aria-current={activeItem === 'categories' ? 'page' : undefined}
      >
        <GridIcon size={20} />
        <span className={styles.label}>Kategoriyalar</span>
      </Link>

      <SoftDisabledButton
        ariaLabel="Qidiruv/skaner — tez orada"
        toastMessage="Tez orada"
        onActivate={onScanSearchActivate}
        className={styles.item}
      >
        <ScanIcon size={20} />
        <span className={styles.label}>Skaner</span>
      </SoftDisabledButton>

      <SoftDisabledButton
        ariaLabel="Sevimlilar — tez orada"
        toastMessage="Tez orada"
        onActivate={onFavoritesActivate}
        className={styles.item}
      >
        <HeartIcon size={20} />
        <span className={styles.label}>Sevimlilar</span>
      </SoftDisabledButton>

      <SoftDisabledButton
        ariaLabel="Profil — tez orada"
        toastMessage="Tez orada"
        onActivate={onProfileActivate}
        className={styles.item}
      >
        <UserIcon size={20} />
        <span className={styles.label}>Profil</span>
      </SoftDisabledButton>
    </nav>
  );
}
