import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhoneInput } from './phone-input';

function Harness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <PhoneInput
      aria-label="Phone"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('PhoneInput', () => {
  it('masks digits as they are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Phone');

    await user.type(input, '8325551234');

    expect(input).toHaveValue('(832)-555-1234');
  });

  it('emits the masked value to the caller', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.type(screen.getByLabelText('Phone'), '832');

    expect(onChange).toHaveBeenLastCalledWith('(832');
  });

  it('ignores non-digit keystrokes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Phone');

    await user.type(input, 'abc832');

    expect(input).toHaveValue('(832');
  });

  it('lets an international number through untouched', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Phone');

    await user.type(input, '+91 98765 43210');

    expect(input).toHaveValue('+91 98765 43210');
  });

  it('shows the expected shape as a placeholder when empty', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Phone')).toHaveAttribute('placeholder', '(832)-555-1234');
  });

  it('renders a stored value formatted', () => {
    render(<PhoneInput aria-label="Phone" value="(832)-555-1234" onChange={() => {}} />);
    expect(screen.getByLabelText('Phone')).toHaveValue('(832)-555-1234');
  });

  // The value the edit forms actually load: a bare 10-digit string straight
  // from the API. Pins that the component formats its INCOMING value, not just
  // what the user types — test 6 above cannot catch this, since it passes a
  // value that is already masked.
  it('formats a raw stored value on first render', () => {
    render(<PhoneInput aria-label="Phone" value="8325551234" onChange={() => {}} />);
    expect(screen.getByLabelText('Phone')).toHaveValue('(832)-555-1234');
  });
});
