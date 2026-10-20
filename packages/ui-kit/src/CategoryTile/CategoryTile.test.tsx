import { render, screen } from '@testing-library/react';
import { CategoryTile } from './CategoryTile.js';

const baseProps = { id: '1', slug: 'electronics', name: 'Electronics', href: '/catalog/electronics' };

describe('CategoryTile', () => {
  it('renders the category name and links to its catalog route', () => {
    render(<CategoryTile {...baseProps} />);
    expect(screen.getByText('Electronics')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/catalog/electronics');
  });

  it('never fabricates a product count when the prop is omitted', () => {
    render(<CategoryTile {...baseProps} />);
    expect(screen.queryByTestId('category-count')).not.toBeInTheDocument();
  });

  it('renders the count only when the caller explicitly supplies one', () => {
    render(<CategoryTile {...baseProps} productCount={12} />);
    expect(screen.getByTestId('category-count')).toHaveTextContent('12');
  });

  it('renders a neutral placeholder, never a fake category photo, when imageUrl is absent', () => {
    render(<CategoryTile {...baseProps} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
