import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders the default message when no custom title is given', () => {
    render(<EmptyState />);
    expect(screen.getByText('Hech narsa topilmadi')).toBeInTheDocument();
  });

  it('renders a custom title and description when supplied', () => {
    render(<EmptyState title="Kategoriya topilmadi" description="Boshqa kategoriyani tanlang." />);
    expect(screen.getByText('Kategoriya topilmadi')).toBeInTheDocument();
    expect(screen.getByText('Boshqa kategoriyani tanlang.')).toBeInTheDocument();
  });

  it('renders an action button and fires its onClick', async () => {
    const onClick = jest.fn();
    render(<EmptyState action={{ label: 'Qayta urinish', onClick }} />);
    screen.getByText('Qayta urinish').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
