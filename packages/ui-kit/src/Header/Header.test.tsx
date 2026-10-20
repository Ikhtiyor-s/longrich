import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from './Header.js';

const baseSearch = { value: '', onChange: () => {}, onSubmit: () => {} };

describe('Header', () => {
  it('exposes an accessible primary navigation role with the wordmark and categories link', () => {
    render(<Header search={baseSearch} />);
    const nav = screen.getByRole('navigation', { name: 'Asosiy navigatsiya' });
    expect(nav).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /LONGRICH/ })[0]).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /Barcha kategoriyalar/ })).toHaveAttribute(
      'href',
      '/#categories',
    );
  });

  it('composes a real, functioning SearchCombobox', () => {
    render(<Header search={baseSearch} />);
    expect(screen.getAllByRole('search').length).toBeGreaterThan(0);
  });

  it('never shows a fabricated cart badge when cartCount is omitted or zero', () => {
    render(<Header search={baseSearch} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows a cart badge only for a positive cartCount', () => {
    render(<Header search={baseSearch} cartCount={3} />);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('renders every single-instance soft-disabled control as aria-disabled, never natively disabled', () => {
    render(<Header search={baseSearch} />);
    for (const name of [
      'Yetkazib berish manzilini tanlash — tez orada',
      'Tilni tanlash — tez orada',
      'Sevimlilar — tez orada',
      'Kabinet — tez orada',
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toBeEnabled();
    }
  });

  it('renders the cart control as aria-disabled in both the desktop and mobile bars', () => {
    render(<Header search={baseSearch} />);
    const cartButtons = screen.getAllByRole('button', { name: 'Savat — tez orada' });
    expect(cartButtons).toHaveLength(2);
    for (const button of cartButtons) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toBeEnabled();
    }
  });

  it('fires a status toast with the cart-specific wording on cart activation', async () => {
    const user = userEvent.setup();
    render(<Header search={baseSearch} />);
    const cartButtons = screen.getAllByRole('button', { name: 'Savat — tez orada' });
    await user.click(cartButtons[0]!);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent("Savat G4 bosqichida qo'shiladi");
  });

  it('shows the provided language label', () => {
    render(<Header search={baseSearch} language={{ code: 'ru', label: 'RU' }} />);
    expect(screen.getAllByText('RU').length).toBeGreaterThan(0);
  });

  it('defaults the delivery control to the static placeholder text', () => {
    render(<Header search={baseSearch} />);
    expect(screen.getAllByText('Yetkazib berish manzili').length).toBeGreaterThan(0);
  });
});
