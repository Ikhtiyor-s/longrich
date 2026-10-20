import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProductDetailDto, ProductVariantDto, PublicOfferDto } from '@longrich/shared-types';
import { ProductClient } from '../product-client';
import type { ProductDetailViewResult } from '../product-client';
import { loadVariantOffers } from '../actions';

const refresh = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

jest.mock('../actions', () => ({
  loadVariantOffers: jest.fn(),
}));

const mockedLoadVariantOffers = loadVariantOffers as jest.MockedFunction<typeof loadVariantOffers>;

function buildVariant(overrides: Partial<ProductVariantDto>): ProductVariantDto {
  return {
    id: 'var-1',
    product_id: 'prod-1',
    options: { color: 'red' },
    status: 'PUBLISHED',
    attribute_values: [{ category_attribute_id: 'attr-1', key: 'color', value: 'red' }],
    media: [],
    offers_summary: { active_offer_count: 0, lowest_price_minor: null, currency: null },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function buildProduct(overrides: Partial<ProductDetailDto>): ProductDetailDto {
  return {
    id: 'prod-1',
    category_id: 'cat-1',
    brand: { id: 'brand-1', name: 'Longrich' },
    title: 'Wireless Mouse',
    description: 'Simple wireless mouse with 2.4GHz receiver.',
    status: 'PUBLISHED',
    canonical_id: null,
    variants: [buildVariant({})],
    media: [],
    offers_summary: { active_offer_count: 0, lowest_price_minor: null, currency: null },
    latest_moderation_decision: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function buildOffer(overrides: Partial<PublicOfferDto>): PublicOfferDto {
  return {
    id: 'offer-1',
    seller_id: 'seller-1',
    seller_name: 'Tashkent Electronics LLC',
    seller_sku: 'SKU-1',
    price_minor: '1000000',
    currency: 'UZS',
    fulfillment_mode: 'SELLER_WAREHOUSE',
    ...overrides,
  };
}

const breadcrumbItems = [
  { label: 'Bosh sahifa', href: '/' },
  { label: 'Aksessuarlar', href: '/catalog/accessories' },
  { label: 'Wireless Mouse' },
];

function okResult(overrides: {
  product?: Partial<ProductDetailDto>;
  initialOffers?: PublicOfferDto[];
  initialOffersError?: string | null;
}): ProductDetailViewResult {
  const product = buildProduct(overrides.product ?? {});
  return {
    status: 'ok',
    product,
    breadcrumbItems,
    initialVariantId: product.variants[0]?.id ?? null,
    initialOffers: overrides.initialOffers ?? [],
    initialOffersError: overrides.initialOffersError ?? null,
  };
}

describe('ProductClient', () => {
  beforeEach(() => {
    refresh.mockClear();
    mockedLoadVariantOffers.mockReset();
  });

  it('renders the not-found EmptyState for an unknown/unpublished product id, never raw JSON', () => {
    render(<ProductClient result={{ status: 'not-found' }} />);

    expect(screen.getByText('Mahsulot topilmadi')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bosh sahifaga qaytish' })).toHaveAttribute('href', '/');
  });

  it('renders an ErrorPanel with a working retry on a genuine fetch failure', () => {
    render(<ProductClient result={{ status: 'error' }} />);

    const retryButton = screen.getByRole('button', { name: 'Qayta urinish' });
    fireEvent.click(retryButton);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('renders the product title, brand and breadcrumb trail, defaulting to the Tavsif tab', () => {
    render(<ProductClient result={okResult({})} />);

    expect(screen.getByRole('heading', { name: 'Wireless Mouse' })).toBeInTheDocument();
    expect(screen.getByText('Longrich')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Aksessuarlar' })).toHaveAttribute('href', '/catalog/accessories');

    const descriptionPanel = screen.getByRole('tabpanel', { name: 'Tavsif' });
    expect(descriptionPanel).toBeVisible();
    expect(descriptionPanel).toHaveTextContent('Simple wireless mouse with 2.4GHz receiver.');

    const attributesTab = screen.getByRole('tab', { name: 'Xususiyatlar' });
    const attributesPanel = document.getElementById(attributesTab.getAttribute('aria-controls')!);
    expect(attributesPanel).not.toBeVisible();
  });

  it('switches to the Xususiyatlar tab via click and shows the selected variant attribute_values', () => {
    render(<ProductClient result={okResult({})} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Xususiyatlar' }));

    const attributesPanel = screen.getByRole('tabpanel', { name: 'Xususiyatlar' });
    expect(attributesPanel).toBeVisible();
    expect(screen.getByText('color')).toBeInTheDocument();
    expect(screen.getByText('red')).toBeInTheDocument();
  });

  it('activates a non-default tab via keyboard Arrow navigation (Tab focus + Arrow activation)', () => {
    render(<ProductClient result={okResult({})} />);

    const descriptionTab = screen.getByRole('tab', { name: 'Tavsif' });
    descriptionTab.focus();
    expect(descriptionTab).toHaveFocus();

    fireEvent.keyDown(descriptionTab, { key: 'ArrowRight' });

    const attributesTab = screen.getByRole('tab', { name: 'Xususiyatlar' });
    expect(attributesTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Xususiyatlar' })).toBeVisible();
  });

  it('renders zero offers via OfferComparison own empty branch with a disabled cart control', () => {
    render(<ProductClient result={okResult({ initialOffers: [] })} />);

    fireEvent.click(screen.getByRole('tab', { name: "Do'konlar" }));

    expect(screen.getByText("Hozircha taklif yo'q")).toBeInTheDocument();
  });

  it('switches variant client-side without reload, fetching and caching offers independently per variant id', async () => {
    const variantA = buildVariant({ id: 'var-a', options: { color: 'red' } });
    const variantB = buildVariant({ id: 'var-b', options: { color: 'blue' } });
    const product = buildProduct({ variants: [variantA, variantB] });

    const result: ProductDetailViewResult = {
      status: 'ok',
      product,
      breadcrumbItems,
      initialVariantId: variantA.id,
      initialOffers: [buildOffer({ id: 'offer-a', seller_name: 'Seller A' })],
      initialOffersError: null,
    };

    mockedLoadVariantOffers.mockResolvedValue({
      offers: [buildOffer({ id: 'offer-b', seller_name: 'Seller B' })],
      error: null,
    });

    render(<ProductClient result={result} />);
    fireEvent.click(screen.getByRole('tab', { name: "Do'konlar" }));

    expect(screen.getByText('Seller A')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'color: blue' }));

    await waitFor(() => expect(screen.getByText('Seller B')).toBeInTheDocument());
    expect(mockedLoadVariantOffers).toHaveBeenCalledWith('var-b');
    expect(mockedLoadVariantOffers).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'color: red' }));

    expect(screen.getByText('Seller A')).toBeInTheDocument();
    expect(mockedLoadVariantOffers).toHaveBeenCalledTimes(1);
  });

  it('the permanently soft-disabled cart CTA is aria-disabled, never natively disabled, and announces the G4 toast on click', () => {
    render(<ProductClient result={okResult({})} />);

    const cartButton = screen.getByRole('button', { name: "Savatga qo'shish — tez orada" });
    expect(cartButton).toHaveAttribute('aria-disabled', 'true');
    expect(cartButton).toBeEnabled();
    expect(screen.getByText("Savat G4 bosqichida qo'shiladi")).toBeInTheDocument();

    fireEvent.click(cartButton);
    expect(screen.getByRole('status')).toHaveTextContent("Savat G4 bosqichida qo'shiladi");
  });
});
