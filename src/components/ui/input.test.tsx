import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './input';

/** A focused <input type="number"> steps its value on mouse-wheel scroll, which silently rewrites
 * a money amount while the user is only trying to scroll the form. Input blurs to prevent it. */
describe('Input number wheel guard', () => {
  it('blurs a focused number input on wheel so its value cannot be stepped', () => {
    render(<Input aria-label="Amount" type="number" defaultValue="450" />);
    const input = screen.getByLabelText('Amount');

    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.wheel(input, { deltaY: 100 });

    expect(document.activeElement).not.toBe(input);
    expect(input).toHaveValue(450);
  });

  it('leaves an UNFOCUSED number input alone (the browser never steps it, so nothing to guard)', () => {
    render(
      <>
        <Input aria-label="Amount" type="number" defaultValue="450" />
        <Input aria-label="Invoice number" />
      </>,
    );
    const elsewhere = screen.getByLabelText('Invoice number');
    elsewhere.focus();

    fireEvent.wheel(screen.getByLabelText('Amount'), { deltaY: 100 });

    // Focus must not be stolen from wherever the user actually was.
    expect(document.activeElement).toBe(elsewhere);
  });

  it('does not blur a focused non-number input', () => {
    render(<Input aria-label="Remark" type="text" />);
    const input = screen.getByLabelText('Remark');
    input.focus();

    fireEvent.wheel(input, { deltaY: 100 });

    expect(document.activeElement).toBe(input);
  });

  it('still calls a caller-supplied onWheel', () => {
    const onWheel = vi.fn();
    render(<Input aria-label="Amount" type="number" onWheel={onWheel} />);
    const input = screen.getByLabelText('Amount');
    input.focus();

    fireEvent.wheel(input, { deltaY: 100 });

    expect(onWheel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });
});
