import { ProductClient } from './product-client';
import type { ProductDetailViewResult } from './product-client';
import { buildBreadcrumbTrail, fetchProductDetail, fetchVariantOffers } from './product-data';
import styles from './product.module.css';

const OFFERS_FETCH_ERROR = "Taklif ro'yxatini olishda xatolik yuz berdi. Keyinroq qayta urinib ko'ring.";

interface ProductDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { id } = await params;
  const detail = await fetchProductDetail(id);

  let result: ProductDetailViewResult;

  if (detail.status === 'not-found') {
    result = { status: 'not-found' };
  } else if (detail.status === 'error') {
    result = { status: 'error' };
  } else {
    const { product } = detail;
    const breadcrumbItems = await buildBreadcrumbTrail(product.category_id, product.title);
    const initialVariantId = product.variants[0]?.id ?? null;
    const offersResult = initialVariantId ? await fetchVariantOffers(initialVariantId) : null;

    result = {
      status: 'ok',
      product,
      breadcrumbItems,
      initialVariantId,
      initialOffers: offersResult?.status === 'ok' ? offersResult.offers : [],
      initialOffersError: offersResult?.status === 'error' ? OFFERS_FETCH_ERROR : null,
    };
  }

  return (
    <div className={styles.page}>
      <ProductClient result={result} />
    </div>
  );
}
