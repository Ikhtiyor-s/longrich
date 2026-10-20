'use client';

import type { ReactNode } from 'react';
import { useSoftDisabled } from './useSoftDisabled.js';
import styles from './SoftDisabledButton.module.css';

export interface SoftDisabledButtonProps {
  children: ReactNode;
  ariaLabel: string;
  toastMessage: string;
  title?: string;
  onActivate?: () => void;
  className?: string;
}

export function SoftDisabledButton({
  children,
  ariaLabel,
  toastMessage,
  title,
  onActivate,
  className,
}: SoftDisabledButtonProps) {
  const { toastVisible, activate } = useSoftDisabled(onActivate);

  return (
    <span className={styles.wrapper}>
      <button
        type="button"
        aria-disabled="true"
        aria-label={ariaLabel}
        title={title ?? toastMessage}
        className={className ? `${styles.button} ${className}` : styles.button}
        onClick={activate}
      >
        {children}
      </button>
      {toastVisible ? (
        <span role="status" aria-live="polite" className={styles.toast}>
          {toastMessage}
        </span>
      ) : null}
    </span>
  );
}
