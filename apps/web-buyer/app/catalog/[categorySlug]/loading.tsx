import { Skeleton } from '@longrich/ui-kit';
import styles from './category.module.css';

export default function CategoryBrowseLoading() {
  return (
    <>
      <div className={styles.breadcrumbWrapper}>
        <Skeleton variant="text-line" />
      </div>
      <div className={styles.headingSkeletonWrapper}>
        <Skeleton variant="text-line" />
      </div>
      <div className={styles.productGrid}>
        <Skeleton variant="product-card" count={8} />
      </div>
    </>
  );
}
