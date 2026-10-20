import styles from './Skeleton.module.css';

export interface SkeletonProps {
  variant: 'product-card' | 'category-tile' | 'offer-row' | 'text-line';
  count?: number;
}

export function Skeleton({ variant, count = 1 }: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          data-testid="skeleton"
          role="presentation"
          aria-hidden="true"
          className={`${styles.pulse} ${styles[variant]}`}
        />
      ))}
    </>
  );
}
