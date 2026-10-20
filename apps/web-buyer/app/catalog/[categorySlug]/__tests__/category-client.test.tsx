import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { CategoryClient } from '../category-client';
import { loadMoreCategoryProducts } from '../actions';
import type { CategoryProductCardData } from '../catalog-data';

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

describe('CategoryClient', () => {
  beforeEach(() => {
    mockedLoadMore.mockReset();
  });

  it('renders the breadcrumb, category heading, and product grid', () => {
    render(
      <CategoryClient
        {...baseProps}
        initialProducts={[makeProduct('p1'), makeProduct('p2')]}
        initialNextCursor={null}
        initialError={null}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Elektronika' })).toBeInTheDocument();
    expect(screen.getByText('Mahsulot p1')).toBeInTheDocument();
    expect(screen.getByText('Mahsulot p2')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: "Yo'nalish" })).toBeInTheDocument();
  });

  it('shows an honest empty state, never an error panel, when the category has zero products', () => {
    render(<CategoryClient {...baseProps} initialProducts={[]} initialNextCursor={null} initialError={null} />);
    expect(screen.getByText('Mahsulot topilmadi')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders an ErrorPanel, not the empty state, when the initial product fetch failed', () => {
    render(
      <CategoryClient
        {...baseProps}
        initialProducts={[]}
        initialNextCursor={null}
        initialError="Mahsulotlarni yuklashda xatolik yuz berdi."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Mahsulotlarni yuklashda xatolik yuz berdi.');
    expect(screen.queryByText('Mahsulot topilmadi')).not.toBeInTheDocument();
  });

  it('renders no sort/filter/brand/price-range/seller/rating/region control anywhere on the page', () => {
    render(
      <CategoryClient
        {...baseProps}
        initialProducts={[makeProduct('p1')]}
        initialNextCursor="cursor-1"
        initialError={null}
      />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/saralash|filtr|brend|narx oralig|sotuvchi bo'yicha|reyting bo'yicha|yetkazib berish/i),
    ).not.toBeInTheDocument();
  });

  it('hides the "Yana yuklash" control once next_cursor is null', () => {
    render(
      <CategoryClient
        {...baseProps}
        initialProducts={[makeProduct('p1')]}
        initialNextCursor={null}
        initialError={null}
      />,
    );
    expect(screen.queryByRole('button', { name: /yana yuklash/i })).not.toBeInTheDocument();
  });

  it('fetches the next cursor page and appends the results on "Yana yuklash"', async () => {
    const user = userEvent.setup();
    mockedLoadMore.mockResolvedValueOnce({ items: [makeProduct('p2')], nextCursor: null, error: null });

    render(
      <CategoryClient
        {...baseProps}
        initialProducts={[makeProduct('p1')]}
        initialNextCursor="cursor-1"
        initialError={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: /yana yuklash/i }));

    await waitFor(() => expect(screen.getByText('Mahsulot p2')).toBeInTheDocument());
    expect(mockedLoadMore).toHaveBeenCalledWith('cat-1', 'cursor-1');
    expect(screen.getByText('Mahsulot p1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /yana yuklash/i })).not.toBeInTheDocument();
  });

  it('renders an ErrorPanel with retry, keeping existing products, when a load-more fetch fails', async () => {
    const user = userEvent.setup();
    mockedLoadMore.mockResolvedValueOnce({
      items: [],
      nextCursor: 'cursor-1',
      error: "Mahsulotlarni yuklashda xatolik yuz berdi. Keyinroq qayta urinib ko'ring.",
    });

    render(
      <CategoryClient
        {...baseProps}
        initialProducts={[makeProduct('p1')]}
        initialNextCursor="cursor-1"
        initialError={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: /yana yuklash/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Qayta urinish' })).toBeInTheDocument();
    expect(screen.getByText('Mahsulot p1')).toBeInTheDocument();
  });
});
