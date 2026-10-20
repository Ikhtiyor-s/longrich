import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { ProductDetailDto, ProductVariantDto, PublicOfferDto } from '@longrich/shared-types';
import { ProductClient } from '../product-client';
import type { ProductDetailViewResult } from '../product-client';
import { loadVariantOffers } from '../actions';

expect.extend(toHaveNoViolations);

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
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
    media: [
      { id: 'media-1', object_key: 'media-1.jpg', position: 0, moderation_status: 'APPROVED' },
      { id: 'media-2', object_key: 'media-2.jpg', position: 1, moderation_status: 'APPROVED' },
    ],
    offers_summary: { active_offer_count: 0, lowest_price_minor: null, currency: null },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function buildProduct(overrides: Partial<ProductDetailDto>): ProductDetailDto {
  const variant = buildVariant({});
  return {
    id: 'prod-1',
    category_id: 'cat-1',
    brand: { id: 'brand-1', name: 'Longrich' },
    title: 'Wireless Mouse',
    description: 'Simple wireless mouse with 2.4GHz receiver.',
    status: 'PUBLISHED',
    canonical_id: null,
    variants: [variant],
    media: variant.media,
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
}): ProductDetailViewResult {
  const product = buildProduct(overrides.product ?? {});
  return {
    status: 'ok',
    product,
    breadcrumbItems,
    initialVariantId: product.variants[0]?.id ?? null,
    initialOffers: overrides.initialOffers ?? [buildOffer({})],
    initialOffersError: null,
  };
}

describe('ProductClient — accessibility', () => {
  beforeEach(() => {
    mockedLoadVariantOffers.mockReset();
  });

  it('has zero serious/critical axe violations on the default (Tavsif) tab', async () => {
    const { container } = render(<ProductClient result={okResult({})} />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has zero serious/critical axe violations on the not-found branch', async () => {
    const { container } = render(<ProductClient result={{ status: 'not-found' }} />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has zero serious/critical axe violations with multiple variants and a populated offer list', async () => {
    const variantA = buildVariant({ id: 'var-a', options: { color: 'red' } });
    const variantB = buildVariant({ id: 'var-b', options: { color: 'blue' } });
    const product = buildProduct({ variants: [variantA, variantB] });

    const { container } = render(
      <ProductClient
        result={{
          status: 'ok',
          product,
          breadcrumbItems,
          initialVariantId: variantA.id,
          initialOffers: [buildOffer({})],
          initialOffersError: null,
        }}
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('reaches a media thumbnail, a variant button, a tab, and the permanent CTA via Tab, operating each via Enter/Space', async () => {
    const variantA = buildVariant({ id: 'var-a', options: { color: 'red' } });
    const variantB = buildVariant({ id: 'var-b', options: { color: 'blue' } });
    const product = buildProduct({ variants: [variantA, variantB] });
    mockedLoadVariantOffers.mockResolvedValue({ offers: [buildOffer({ id: 'offer-b' })], error: null });

    const user = userEvent.setup();
    render(
      <ProductClient
        result={{
          status: 'ok',
          product,
          breadcrumbItems,
          initialVariantId: variantA.id,
          initialOffers: [buildOffer({ id: 'offer-a' })],
          initialOffersError: null,
        }}
      />,
    );

    await user.tab();
    expect(screen.getByRole('link', { name: 'Bosh sahifa' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('link', { name: 'Aksessuarlar' })).toHaveFocus();

    const firstThumb = screen.getByRole('button', { name: '1-rasm' });
    firstThumb.focus();
    expect(firstThumb).toHaveFocus();

    const colorBlueButton = screen.getByRole('button', { name: 'color: blue' });
    colorBlueButton.focus();
    expect(colorBlueButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(colorBlueButton).toHaveAttribute('aria-pressed', 'true');

    const storesTab = screen.getByRole('tab', { name: "Do'konlar" });
    storesTab.focus();
    expect(storesTab).toHaveFocus();
    await user.keyboard(' ');
    expect(storesTab).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(mockedLoadVariantOffers).toHaveBeenCalledWith('var-b'));

    const cartButton = screen.getByRole('button', { name: "Savatga qo'shish — tez orada" });
    cartButton.focus();
    expect(cartButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent("Savat G4 bosqichida qo'shiladi");
  });
});
