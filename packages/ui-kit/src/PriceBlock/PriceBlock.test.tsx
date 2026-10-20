import { render, screen } from '@testing-library/react';
import { PriceBlock } from './PriceBlock.js';

describe('PriceBlock', () => {
  it('formats a price_minor digit-string into a grouped so\'m value', () => {
    render(<PriceBlock priceMinor="1250000" />);
    expect(screen.getByText("12 500 so'm")).toBeInTheDocument();
  });

  it('renders the muted no-price text when priceMinor is null', () => {
    render(<PriceBlock priceMinor={null} />);
    expect(screen.getByText('Narx mavjud emas')).toBeInTheDocument();
  });

  it('never shows a struck previous price unless one is explicitly passed', () => {
    render(<PriceBlock priceMinor="1250000" />);
    expect(screen.queryByText(/so'm/, { selector: '.previous' })).not.toBeInTheDocument();
  });

  it('shows a struck previous price only when explicitly passed', () => {
    render(<PriceBlock priceMinor="1000000" previousPriceMinor="1500000" />);
    expect(screen.getByText("15 000 so'm")).toBeInTheDocument();
    expect(screen.getByText("10 000 so'm")).toBeInTheDocument();
  });
});
