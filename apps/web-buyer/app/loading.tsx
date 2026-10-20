import { Skeleton } from '@longrich/ui-kit';
import styles from './home-client.module.css';

export default function Loading() {
  return (
    <>
      <section className={styles.hero} aria-hidden="true" />
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Kategoriyalar</h2>
        <div className={styles.categoryGrid}>
          <Skeleton variant="category-tile" count={12} />
        </div>
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Barcha mahsulotlar</h2>
        <div className={styles.productGrid}>
          <Skeleton variant="product-card" count={8} />
        </div>
      </section>
    </>
  );
}
