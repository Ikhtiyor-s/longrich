import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ErrorPanel } from './ErrorPanel.js';

describe('ErrorPanel', () => {
  it('renders the default message when none is given', () => {
    render(<ErrorPanel />);
    expect(screen.getByText("Xatolik yuz berdi. Keyinroq qayta urinib ko'ring.")).toBeInTheDocument();
  });

  it('renders no retry button when onRetry is not provided', () => {
    render(<ErrorPanel />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('fires onRetry when the retry button is clicked', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    render(<ErrorPanel onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Qayta urinish' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('fires onRetry when the retry button is activated via Enter', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    render(<ErrorPanel onRetry={onRetry} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
