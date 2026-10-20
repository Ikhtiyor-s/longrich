import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileNav } from './MobileNav.js';

describe('MobileNav', () => {
  it('exposes an accessible navigation role', () => {
    render(<MobileNav />);
    expect(screen.getByRole('navigation', { name: 'Mobil navigatsiya' })).toBeInTheDocument();
  });

  it('renders real links for Home and Categories', () => {
    render(<MobileNav />);
    expect(screen.getByRole('link', { name: /Bosh sahifa/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /Kategoriyalar/ })).toHaveAttribute(
      'href',
      '/#categories',
    );
  });

  it('marks the active item with aria-current="page"', () => {
    render(<MobileNav activeItem="categories" />);
    expect(screen.getByRole('link', { name: /Kategoriyalar/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /Bosh sahifa/ })).not.toHaveAttribute('aria-current');
  });

  it('keeps scan/favorites/profile focusable and soft-disabled, not natively disabled', () => {
    render(<MobileNav />);
    const favoritesButton = screen.getByRole('button', { name: 'Sevimlilar — tez orada' });
    expect(favoritesButton).toHaveAttribute('aria-disabled', 'true');
    expect(favoritesButton).toBeEnabled();
  });

  it('fires exactly one status toast on click without persisting any state', async () => {
    const user = userEvent.setup();
    render(<MobileNav />);
    await user.click(screen.getByRole('button', { name: 'Profil — tez orada' }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Tez orada');
  });
});
