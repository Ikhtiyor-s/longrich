import styles from './PriceBlock.module.css';

export interface PriceBlockProps {
  priceMinor: string | null;
  previousPriceMinor?: string | null;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
}

function formatSom(priceMinor: string): string {
  const som = Math.round(Number(priceMinor) / 100);
  return `${som.toLocaleString('ru-RU')} so'm`;
}

export function PriceBlock({ priceMinor, previousPriceMinor, size = 'md' }: PriceBlockProps) {
  if (priceMinor == null) {
    return <span className={`${styles.noPrice} ${styles[size]}`}>Narx mavjud emas</span>;
  }

  return (
    <span className={`${styles.wrapper} ${styles[size]}`}>
      {previousPriceMinor != null && <span className={styles.previous}>{formatSom(previousPriceMinor)}</span>}
      <span className={styles.price}>{formatSom(priceMinor)}</span>
    </span>
  );
}
