import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProductCard } from './ProductCard.js';

const baseProps = { id: 'p1', title: 'Wireless Mouse', href: '/product/p1' };

describe('ProductCard', () => {
  it('renders the formatted price when one is supplied', () => {
    render(<ProductCard {...baseProps} priceMinor="1250000" />);
    expect(screen.getByText("12 500 so'm")).toBeInTheDocument();
  });

  it('renders "Narx mavjud emas" and a disabled add-to-cart control when there is no active offer', () => {
    render(<ProductCard {...baseProps} priceMinor={null} />);
    expect(screen.getAllByText('Narx mavjud emas').length).toBeGreaterThan(0);
    const cartButton = screen.getByRole('button', { name: 'Narx mavjud emas' });
    expect(cartButton).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the add-to-cart control soft-disabled even when a price is available (no cart backend yet)', () => {
    render(<ProductCard {...baseProps} priceMinor="1250000" />);
    const cartButton = screen.getByRole('button', { name: "Savat G4 bosqichida qo'shiladi" });
    expect(cartButton).toHaveAttribute('aria-disabled', 'true');
  });

  it('fires a toast on the favorite control without persisting any state', async () => {
    const user = userEvent.setup();
    render(<ProductCard {...baseProps} priceMinor="1250000" />);
    await user.click(screen.getByRole('button', { name: "Sevimlilarga qo'shish — tez orada" }));
    expect(screen.getByRole('status')).toHaveTextContent("Sevimlilarga qo'shish — tez orada");
  });

  it('never renders a dark prop as a fabricated value', () => {
    render(
      <ProductCard
        {...baseProps}
        priceMinor="1250000"
        rating={{ average: 4.5, verifiedCount: 10 }}
        sellerName="Some Seller"
        stockLabel="Omborda bor"
        deliveryLabel="Ertaga"
      />,
    );
    expect(screen.queryByText(/sharh/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Some Seller')).not.toBeInTheDocument();
    expect(screen.queryByText('Omborda bor')).not.toBeInTheDocument();
    expect(screen.queryByText('Ertaga')).not.toBeInTheDocument();
  });
});
