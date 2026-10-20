import { render, screen, within } from '@testing-library/react';
import { AppShell } from './AppShell.js';

const baseSearch = { value: '', onChange: () => {}, onSubmit: () => {} };

describe('AppShell', () => {
  it('renders the Header, children and MobileNav chrome by default', () => {
    render(
      <AppShell header={{ search: baseSearch }}>
        <p>Sahifa tarkibi</p>
      </AppShell>,
    );
    expect(screen.getByRole('navigation', { name: 'Asosiy navigatsiya' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Mobil navigatsiya' })).toBeInTheDocument();
    expect(screen.getByText('Sahifa tarkibi')).toBeInTheDocument();
  });

  it('renders the default footer text when no footer is supplied', () => {
    render(
      <AppShell header={{ search: baseSearch }}>
        <p>Sahifa tarkibi</p>
      </AppShell>,
    );
    expect(screen.getByText(/katalog bo'limi/)).toBeInTheDocument();
  });

  it('renders a custom footer instead of the default when supplied', () => {
    render(
      <AppShell header={{ search: baseSearch }} footer={<p>Maxsus footer</p>}>
        <p>Sahifa tarkibi</p>
      </AppShell>,
    );
    expect(screen.getByText('Maxsus footer')).toBeInTheDocument();
    expect(screen.queryByText(/katalog bo'limi/)).not.toBeInTheDocument();
  });

  it('derives MobileNav defaults from the Header handlers when mobileNav is omitted', () => {
    render(
      <AppShell
        header={{
          search: baseSearch,
          onFavoritesActivate: () => {},
          onAccountActivate: () => {},
        }}
      >
        <p>Sahifa tarkibi</p>
      </AppShell>,
    );
    const mobileNav = within(screen.getByRole('navigation', { name: 'Mobil navigatsiya' }));
    expect(mobileNav.getByRole('button', { name: 'Sevimlilar — tez orada' })).toBeInTheDocument();
    expect(mobileNav.getByRole('button', { name: 'Profil — tez orada' })).toBeInTheDocument();
  });
});
