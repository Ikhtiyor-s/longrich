import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { HomeClient } from '../home-client';
import type { FetchResult, ProductCardViewModel } from '../home-client';
import type { CategoryDto } from '@longrich/shared-types';

const refresh = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
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

const errorResult = { status: 'error' as const };

describe('HomeClient', () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it('renders the category grid via CategoryTile and the product grid via ProductCard', () => {
    render(<HomeClient categories={okResult([fixtureCategory])} products={okResult([fixtureProduct])} />);

    expect(screen.getByRole('link', { name: 'Telefonlar' })).toHaveAttribute('href', '/catalog/phones');
    expect(screen.getByText('Smartphone Alpha 128GB')).toBeInTheDocument();
    expect(screen.getByText("12 500 so'm")).toBeInTheDocument();
  });

  it('renders EmptyState when categories and products both resolve to zero items', () => {
    render(<HomeClient categories={okResult([])} products={okResult([])} />);

    expect(screen.getByText('Kategoriyalar topilmadi')).toBeInTheDocument();
    expect(screen.getByText("Hozircha nashr qilingan mahsulot yo'q")).toBeInTheDocument();
  });

  it('renders an ErrorPanel with a working retry for each failed fetch instead of an empty grid', () => {
    render(<HomeClient categories={errorResult} products={errorResult} />);

    const retryButtons = screen.getAllByRole('button', { name: 'Qayta urinish' });
    expect(retryButtons).toHaveLength(2);

    fireEvent.click(retryButtons[0]!);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a soft-disabled quick-access item non-functional but announces a toast on activation', () => {
    render(<HomeClient categories={okResult([])} products={okResult([])} />);

    const dealsButton = screen.getByRole('button', { name: 'Aksiyalar — tez orada' });
    expect(dealsButton).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(dealsButton);
    const statusMessages = screen.getAllByRole('status').map((el) => el.textContent);
    expect(statusMessages).toContain('Tez orada');
  });
});
