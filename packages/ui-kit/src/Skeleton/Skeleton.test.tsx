import { render, screen } from '@testing-library/react';
import { Skeleton } from './Skeleton.js';

describe('Skeleton', () => {
  it('renders a single placeholder block by default', () => {
    render(<Skeleton variant="product-card" />);
    expect(screen.getAllByTestId('skeleton')).toHaveLength(1);
  });

  it('renders `count` placeholder blocks', () => {
    render(<Skeleton variant="offer-row" count={3} />);
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
  });
});
