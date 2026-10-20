import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchCombobox } from './SearchCombobox.js';

function Controlled({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('');
  return <SearchCombobox value={value} onChange={setValue} onSubmit={onSubmit} />;
}

describe('SearchCombobox', () => {
  it('exposes an accessible search role', () => {
    render(<SearchCombobox value="" onChange={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('calls onChange as the user types, with no fetch/filter side-effect from typing alone', async () => {
    const user = userEvent.setup();
    const fetchMock = jest.fn();
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
    const onSubmit = jest.fn();
    render(<Controlled onSubmit={onSubmit} />);

    await user.type(screen.getByRole('searchbox'), 'blanket');

    expect(screen.getByRole('searchbox')).toHaveValue('blanket');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    delete (globalThis as unknown as { fetch?: typeof fetchMock }).fetch;
  });

  it('disables the submit control when the value is empty', () => {
    render(<SearchCombobox value="" onChange={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Qidirish' })).toBeDisabled();
  });

  it('enables the submit control and fires onSubmit for a non-empty value', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<SearchCombobox value="blanket" onChange={() => {}} onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: 'Qidirish' });
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    expect(onSubmit).toHaveBeenCalledWith('blanket');
  });

  it('moves focus into the input on click (keyboard-reachable control)', async () => {
    const user = userEvent.setup();
    render(<SearchCombobox value="" onChange={() => {}} onSubmit={() => {}} />);
    await user.click(screen.getByRole('searchbox'));
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });
});
