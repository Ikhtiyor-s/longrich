import styles from './CategoryTile.module.css';

export interface CategoryTileProps {
  id: string;
  slug: string;
  name: string;
  href: string;
  imageUrl?: string | null;
  productCount?: number;
}

export function CategoryTile({ name, href, imageUrl, productCount }: CategoryTileProps) {
  return (
    <a href={href} className={styles.tile}>
      {imageUrl ? (
        <img src={imageUrl} alt={name} className={styles.image} width={120} height={120} />
      ) : (
        <div className={styles.imagePlaceholder} aria-hidden="true" />
      )}
      <span className={styles.name}>{name}</span>
      {typeof productCount === 'number' && (
        <span className={styles.count} data-testid="category-count">
          {productCount}
        </span>
      )}
    </a>
  );
}
