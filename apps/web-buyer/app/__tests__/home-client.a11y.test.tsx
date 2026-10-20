import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { HomeClient } from '../home-client';
import type { FetchResult, ProductCardViewModel } from '../home-client';
import type { CategoryDto } from '@longrich/shared-types';

expect.extend(toHaveNoViolations);

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const fixtureCategory: CategoryDto = {
  id: 'cat-1',
  parent_id: 'cat-0',
  slug: 'phones',
  name: 'Telefonlar',
  status: 'ACTIVE',
  requires_certification: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  version: 1,
};

const fixtureProduct: ProductCardViewModel = {
  id: 'prod-1',
  title: 'Smartphone Alpha 128GB',
  priceMinor: '1250000',
  currency: 'UZS',
  coverImageUrl: null,
};

function okResult<T>(data: T): FetchResult<T> {
  return { status: 'ok', data };
}

describe('HomeClient — accessibility', () => {
  it('has zero serious/critical axe violations with populated categories and products', async () => {
    const { container } = render(
      <HomeClient categories={okResult([fixtureCategory])} products={okResult([fixtureProduct])} />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has zero serious/critical axe violations in the empty-state branch', async () => {
    const { container } = render(<HomeClient categories={okResult([])} products={okResult([])} />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('reaches the real "Kategoriyalar" quick-access link and a soft-disabled quick-access item via Tab, operating the latter with Space', async () => {
    const user = userEvent.setup();
    render(<HomeClient categories={okResult([fixtureCategory])} products={okResult([fixtureProduct])} />);

    await user.tab();
    expect(screen.getByRole('link', { name: 'Katalogni ko‘rish' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('link', { name: 'Kategoriyalar' })).toHaveFocus();

    await user.tab();
    const dealsButton = screen.getByRole('button', { name: 'Aksiyalar — tez orada' });
    expect(dealsButton).toHaveFocus();

    await user.keyboard(' ');
    expect(within(dealsButton.closest('span')!).getByRole('status')).toHaveTextContent('Tez orada');
  });

  it('reaches a CategoryTile link via Tab and operates the ProductCard favorite/cart controls via Enter', async () => {
    const user = userEvent.setup();
    render(<HomeClient categories={okResult([fixtureCategory])} products={okResult([fixtureProduct])} />);

    const categoryLink = screen.getByRole('link', { name: 'Telefonlar' });
    categoryLink.focus();
    expect(categoryLink).toHaveFocus();

    const favoriteButton = screen.getByRole('button', { name: "Sevimlilarga qo'shish — tez orada" });
    favoriteButton.focus();
    expect(favoriteButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent("Sevimlilarga qo'shish — tez orada");

    const cartButton = screen.getByRole('button', { name: "Savat G4 bosqichida qo'shiladi" });
    cartButton.focus();
    expect(cartButton).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('status')).toHaveTextContent("Savat G4 bosqichida qo'shiladi");
  });
});
