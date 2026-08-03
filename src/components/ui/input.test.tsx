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

/** Arrow keys are the third way the browser steps a number field, after the spin buttons (hidden
 * app-wide) and the mouse wheel (guarded above). Same corruption, same answer. */
describe('Input number arrow-step guard', () => {
  it('refuses ArrowUp and ArrowDown on a number input', () => {
    render(<Input aria-label="Amount" type="number" defaultValue="450" />);
    const input = screen.getByLabelText('Amount');

    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(false); // preventDefault() was called
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false);
  });

  // Left/Right move the caret and must keep working — only the two STEPPING keys are blocked.
  it('leaves ArrowLeft and ArrowRight alone', () => {
    render(<Input aria-label="Amount" type="number" defaultValue="450" />);
    const input = screen.getByLabelText('Amount');

    expect(fireEvent.keyDown(input, { key: 'ArrowLeft' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'ArrowRight' })).toBe(true);
  });

  it('leaves a text input alone, where arrows do not step anything', () => {
    render(<Input aria-label="Remark" type="text" />);
    const input = screen.getByLabelText('Remark');

    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(true);
  });

  it('still calls a caller-supplied onKeyDown', () => {
    const onKeyDown = vi.fn();
    render(<Input aria-label="Amount" type="number" onKeyDown={onKeyDown} />);

    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'ArrowUp' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

/** `min="0"` alone only marks a field invalid on submit — the browser still happily accepts a typed
 * minus sign. A money field that declares it cannot go negative should refuse the character. */
describe('Input negative guard', () => {
  it('refuses a typed minus sign on a number input floored at zero', () => {
    render(<Input aria-label="Amount" type="number" min="0" />);

    const blocked = fireEvent.keyDown(screen.getByLabelText('Amount'), { key: '-' });

    expect(blocked).toBe(false); // preventDefault() was called
  });

  it('refuses a pasted negative value', () => {
    render(<Input aria-label="Amount" type="number" min="0" />);

    const blocked = fireEvent.paste(screen.getByLabelText('Amount'), {
      clipboardData: { getData: () => '-900' },
    });

    expect(blocked).toBe(false);
  });

  it('allows a pasted positive value', () => {
    render(<Input aria-label="Amount" type="number" min="0" />);

    const allowed = fireEvent.paste(screen.getByLabelText('Amount'), {
      clipboardData: { getData: () => '900' },
    });

    expect(allowed).toBe(true);
  });

  // The guard is keyed on the DECLARED floor, so a field that never asked for one is untouched —
  // this is enforcing `min`, not imposing a new app-wide policy on number inputs.
  it('leaves a number input WITHOUT a floor alone', () => {
    render(<Input aria-label="Delta" type="number" />);

    const allowed = fireEvent.keyDown(screen.getByLabelText('Delta'), { key: '-' });

    expect(allowed).toBe(true);
  });

  it('leaves a text input alone', () => {
    render(<Input aria-label="Remark" type="text" min="0" />);

    const allowed = fireEvent.keyDown(screen.getByLabelText('Remark'), { key: '-' });

    expect(allowed).toBe(true);
  });

  it('does not block ordinary digits, or navigation keys like Backspace', () => {
    render(<Input aria-label="Amount" type="number" min="0" />);
    const input = screen.getByLabelText('Amount');

    expect(fireEvent.keyDown(input, { key: '9' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: '.' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'Backspace' })).toBe(true);
  });

  it('still calls caller-supplied onKeyDown and onPaste', () => {
    const onKeyDown = vi.fn();
    const onPaste = vi.fn();
    render(<Input aria-label="Amount" type="number" min="0" onKeyDown={onKeyDown} onPaste={onPaste} />);
    const input = screen.getByLabelText('Amount');

    fireEvent.keyDown(input, { key: '-' });
    fireEvent.paste(input, { clipboardData: { getData: () => '-900' } });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenCalledTimes(1);
  });
});
