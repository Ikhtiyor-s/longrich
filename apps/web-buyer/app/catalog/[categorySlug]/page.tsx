import { EmptyState, ErrorPanel } from '@longrich/ui-kit';
import { CategoryClient } from './category-client';
import {
  buildBreadcrumbTrail,
  fetchCategories,
  fetchCategoryProductsPage,
  resolveCategoryBySlug,
  resolveProductCardData,
} from './catalog-data';

const CATEGORIES_FETCH_ERROR = "Kategoriyalarni yuklashda xatolik yuz berdi. Keyinroq qayta urinib ko'ring.";
const PRODUCTS_FETCH_ERROR = "Mahsulotlarni yuklashda xatolik yuz berdi. Keyinroq qayta urinib ko'ring.";

interface CategoryBrowsePageProps {
  params: Promise<{ categorySlug: string }>;
}

export default async function CategoryBrowsePage({ params }: CategoryBrowsePageProps) {
  const { categorySlug } = await params;
  const categories = await fetchCategories();

  if (categories === null) {
    return <ErrorPanel message={CATEGORIES_FETCH_ERROR} />;
  }

  const category = resolveCategoryBySlug(categories, categorySlug);

  if (!category) {
    return (
      <EmptyState
        title="Kategoriya topilmadi"
        description="Ushbu manzil bo'yicha kategoriya mavjud emas."
        action={{ label: 'Bosh sahifaga qaytish', href: '/' }}
      />
    );
  }

  const breadcrumbItems = buildBreadcrumbTrail(categories, category);
  const firstPage = await fetchCategoryProductsPage(category.id);

  const initialProducts = firstPage ? await Promise.all(firstPage.items.map(resolveProductCardData)) : [];
  const initialNextCursor = firstPage?.next_cursor ?? null;
  const initialError = firstPage ? null : PRODUCTS_FETCH_ERROR;

  return (
    <CategoryClient
      categoryId={category.id}
      categoryName={category.name}
      breadcrumbItems={breadcrumbItems}
      initialProducts={initialProducts}
      initialNextCursor={initialNextCursor}
      initialError={initialError}
    />
  );
}
