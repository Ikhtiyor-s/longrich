import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { CategoryClient } from '../category-client';
import { loadMoreCategoryProducts } from '../actions';
import type { CategoryProductCardData } from '../catalog-data';

expect.extend(toHaveNoViolations);

jest.mock('../actions', () => ({
  loadMoreCategoryProducts: jest.fn(),
}));

const mockedLoadMore = loadMoreCategoryProducts as jest.MockedFunction<typeof loadMoreCategoryProducts>;

const baseProps = {
  categoryId: 'cat-1',
  categoryName: 'Elektronika',
  breadcrumbItems: [{ label: 'Bosh sahifa', href: '/' }, { label: 'Elektronika' }],
};

function makeProduct(id: string): CategoryProductCardData {
  return {
    id,
    title: `Mahsulot ${id}`,
    href: `/product/${id}`,
    coverImageUrl: null,
    priceMinor: '1000000',
    currency: 'UZS',
  };
}

describe('CategoryClient — accessibility', () => {
  beforeEach(() => {
    mockedLoadMore.mockReset();
  });

  it('has zero serious/critical axe violations with a populated product grid and load-more control', async () => {
    const { container } = render(
      <CategoryClient
        {...baseProps}
        initialProducts={[makeProduct('p1'), makeProduct('p2')]}
        initialNextCursor="cursor-1"
        initialError={null}
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has zero serious/critical axe violations in the empty-state branch', async () => {
    const { container } = render(
      <CategoryClient {...baseProps} initialProducts={[]} initialNextCursor={null} initialError={null} />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('reaches a breadcrumb link, a ProductCard control, and the load-more button via Tab, operating each via Enter/Space', async () => {
    mockedLoadMore.mockResolvedValueOnce({ items: [makeProduct('p2')], nextCursor: null, error: null });
    const user = userEvent.setup();
    render(
      <CategoryClient
        {...baseProps}
        initialProducts={[makeProduct('p1')]}
        initialNextCursor="cursor-1"
        initialError={null}
      />,
    );

    await user.tab();
    expect(screen.getByRole('link', { name: 'Bosh sahifa' })).toHaveFocus();

    const favoriteButton = screen.getByRole('button', { name: "Sevimlilarga qo'shish — tez orada" });
    favoriteButton.focus();
    expect(favoriteButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent("Sevimlilarga qo'shish — tez orada");

    const loadMoreButton = screen.getByRole('button', { name: 'Yana yuklash' });
    loadMoreButton.focus();
    expect(loadMoreButton).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('Mahsulot p2')).toBeInTheDocument());
    expect(mockedLoadMore).toHaveBeenCalledWith('cat-1', 'cursor-1');
  });
});
