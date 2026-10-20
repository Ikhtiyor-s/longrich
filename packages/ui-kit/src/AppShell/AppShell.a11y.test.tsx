import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AppShell } from './AppShell.js';

expect.extend(toHaveNoViolations);

const baseSearch = { value: '', onChange: () => {}, onSubmit: () => {} };

describe('AppShell — accessibility', () => {
  it('has zero serious/critical axe violations with a populated header', async () => {
    const { container } = render(
      <AppShell header={{ search: baseSearch, cartCount: 2, language: { code: 'uz', label: 'UZ' } }}>
        <p>Sahifa tarkibi</p>
      </AppShell>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('reaches every desktop Header icon button via sequential Tab, in left-to-right order', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AppShell header={{ search: baseSearch }}>
        <p>Sahifa tarkibi</p>
      </AppShell>,
    );
    const desktopHeader = within(container.querySelector('header')!);

    await user.tab();
    expect(desktopHeader.getByRole('link', { name: /LONGRICH/ })).toHaveFocus();

    await user.tab();
    expect(desktopHeader.getByRole('link', { name: /Barcha kategoriyalar/ })).toHaveFocus();

    await user.tab();
    expect(desktopHeader.getByRole('searchbox')).toHaveFocus();

    await user.tab();
    expect(
      desktopHeader.getByRole('button', { name: 'Yetkazib berish manzilini tanlash — tez orada' }),
    ).toHaveFocus();

    await user.tab();
    expect(desktopHeader.getByRole('button', { name: 'Tilni tanlash — tez orada' })).toHaveFocus();

    await user.tab();
    expect(desktopHeader.getByRole('button', { name: 'Sevimlilar — tez orada' })).toHaveFocus();

    await user.tab();
    expect(desktopHeader.getByRole('button', { name: 'Kabinet — tez orada' })).toHaveFocus();

    await user.tab();
    const cartButton = desktopHeader.getByRole('button', { name: 'Savat — tez orada' });
    expect(cartButton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent("Savat G4 bosqichida qo'shiladi");
  });

  it('walks backward from the cart icon to the categories link via Shift+Tab', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AppShell header={{ search: baseSearch }}>
        <p>Sahifa tarkibi</p>
      </AppShell>,
    );
    const desktopHeader = within(container.querySelector('header')!);

    desktopHeader.getByRole('button', { name: 'Savat — tez orada' }).focus();
    expect(desktopHeader.getByRole('button', { name: 'Savat — tez orada' })).toHaveFocus();

    await user.tab({ shift: true });
    expect(desktopHeader.getByRole('button', { name: 'Kabinet — tez orada' })).toHaveFocus();

    await user.tab({ shift: true });
    expect(desktopHeader.getByRole('button', { name: 'Sevimlilar — tez orada' })).toHaveFocus();

    await user.tab({ shift: true });
    expect(desktopHeader.getByRole('button', { name: 'Tilni tanlash — tez orada' })).toHaveFocus();

    await user.tab({ shift: true });
    expect(
      desktopHeader.getByRole('button', { name: 'Yetkazib berish manzilini tanlash — tez orada' }),
    ).toHaveFocus();

    await user.tab({ shift: true });
    expect(desktopHeader.getByRole('searchbox')).toHaveFocus();

    await user.tab({ shift: true });
    expect(desktopHeader.getByRole('link', { name: /Barcha kategoriyalar/ })).toHaveFocus();
  });

  it('operates every soft-disabled MobileNav item via Tab + Enter/Space, each firing its own toast', async () => {
    const user = userEvent.setup();
    render(
      <AppShell header={{ search: baseSearch }}>
        <p>Sahifa tarkibi</p>
      </AppShell>,
    );
    const mobileNav = within(screen.getByRole('navigation', { name: 'Mobil navigatsiya' }));

    const scanButton = mobileNav.getByRole('button', { name: 'Qidiruv/skaner — tez orada' });
    scanButton.focus();
    expect(scanButton).toHaveFocus();
    await user.keyboard(' ');
    expect(within(scanButton.closest('span')!).getByRole('status')).toHaveTextContent('Tez orada');

    await user.tab();
    const favoritesButton = mobileNav.getByRole('button', { name: 'Sevimlilar — tez orada' });
    expect(favoritesButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(within(favoritesButton.closest('span')!).getByRole('status')).toHaveTextContent('Tez orada');

    await user.tab();
    const profileButton = mobileNav.getByRole('button', { name: 'Profil — tez orada' });
    expect(profileButton).toHaveFocus();
    await user.keyboard(' ');
    expect(within(profileButton.closest('span')!).getByRole('status')).toHaveTextContent('Tez orada');
  });
});
