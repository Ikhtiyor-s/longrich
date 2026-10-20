import { render, screen } from '@testing-library/react';
import type { PublicOfferDto } from '@longrich/shared-types';
import { OfferComparison } from './OfferComparison.js';

function makeOffer(overrides: Partial<PublicOfferDto>): PublicOfferDto {
  return {
    id: 'o1',
    seller_id: 's1',
    seller_name: 'Seller One',
    seller_sku: 'SKU-1',
    price_minor: '1000000',
    currency: 'UZS',
    fulfillment_mode: 'SELLER_WAREHOUSE',
    ...overrides,
  };
}

describe('OfferComparison', () => {
  it('shows the empty-copy branch and a disabled cart control when there are no offers', () => {
    render(<OfferComparison offers={[]} />);
    expect(screen.getByText("Hozircha taklif yo'q")).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders a Skeleton while loading instead of the empty state', () => {
    render(<OfferComparison offers={[]} isLoading />);
    expect(screen.queryByText("Hozircha taklif yo'q")).not.toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton')).toHaveLength(2);
  });

  it('renders an ErrorPanel with retry when error is set', () => {
    const onRetry = jest.fn();
    render(<OfferComparison offers={[]} error="Taklif ro'yxatini olishda xatolik" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Taklif ro'yxatini olishda xatolik");
    expect(screen.getByRole('button', { name: 'Qayta urinish' })).toBeInTheDocument();
  });

  it('sorts offers ascending by price_minor using BigInt comparison, not lossy Number()', () => {
    const offers = [
      makeOffer({ id: 'expensive', seller_name: 'Expensive Seller', price_minor: '9007199254740993000' }),
      makeOffer({ id: 'cheap', seller_name: 'Cheap Seller', price_minor: '500000' }),
      makeOffer({ id: 'mid', seller_name: 'Mid Seller', price_minor: '9007199254740992000' }),
    ];
    render(<OfferComparison offers={offers} />);
    const sellerNames = screen.getAllByText(/Seller$/).map((node) => node.textContent);
    expect(sellerNames).toEqual(['Cheap Seller', 'Mid Seller', 'Expensive Seller']);
  });

  it('renders the real seller_name per row', () => {
    render(<OfferComparison offers={[makeOffer({ seller_name: 'Tashkent Electronics LLC' })]} />);
    expect(screen.getByText('Tashkent Electronics LLC')).toBeInTheDocument();
  });
});
