import { render, screen } from '@testing-library/react';
import { Breadcrumb } from './Breadcrumb.js';

describe('Breadcrumb', () => {
  it('renders nothing for an empty item list', () => {
    const { container } = render(<Breadcrumb items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes an accessible navigation role with a Yo\'nalish name', () => {
    render(<Breadcrumb items={[{ label: 'Bosh sahifa', href: '/' }, { label: 'Kategoriya' }]} />);
    expect(screen.getByRole('navigation', { name: "Yo'nalish" })).toBeInTheDocument();
  });

  it('links every item except the last', () => {
    render(
      <Breadcrumb
        items={[
          { label: 'Bosh sahifa', href: '/' },
          { label: 'Kiyim', href: '/catalog/kiyim' },
          { label: 'Ko\'ylaklar' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Bosh sahifa' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Kiyim' })).toHaveAttribute('href', '/catalog/kiyim');
    expect(screen.queryByRole('link', { name: "Ko'ylaklar" })).not.toBeInTheDocument();
  });

  it('marks the last item as the current page', () => {
    render(<Breadcrumb items={[{ label: 'Bosh sahifa', href: '/' }, { label: 'Kiyim' }]} />);
    const current = screen.getByText('Kiyim');
    expect(current).toHaveAttribute('aria-current', 'page');
  });
});
