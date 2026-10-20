'use client';

import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

export function EmptyState({ title = 'Hech narsa topilmadi', description, action }: EmptyStateProps) {
  return (
    <div className={styles.wrapper} role="status">
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action &&
        (action.href ? (
          <a href={action.href} className={styles.action}>
            {action.label}
          </a>
        ) : (
          <button type="button" className={styles.action} onClick={action.onClick}>
            {action.label}
          </button>
        ))}
    </div>
  );
}
