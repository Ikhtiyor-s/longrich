'use client';

import { AlertCircleIcon } from '../icons/index.js';
import styles from './ErrorPanel.module.css';

export interface ErrorPanelProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorPanel({ message = "Xatolik yuz berdi. Keyinroq qayta urinib ko'ring.", onRetry }: ErrorPanelProps) {
  return (
    <div className={styles.wrapper} role="alert">
      <AlertCircleIcon size={28} className={styles.icon} />
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          Qayta urinish
        </button>
      )}
    </div>
  );
}
