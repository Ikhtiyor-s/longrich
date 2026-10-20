import { Skeleton } from '@longrich/ui-kit';
import styles from './product.module.css';

export default function ProductDetailLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.breadcrumbWrapper}>
        <Skeleton variant="text-line" />
      </div>
      <div className={styles.mediaBlock}>
        <Skeleton variant="product-card" />
      </div>
      <Skeleton variant="text-line" count={3} />
    </div>
  );
}
