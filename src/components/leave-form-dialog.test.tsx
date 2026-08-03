import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeaveFormDialog } from './leave-form-dialog';

function setup() {
  const onDiscard = vi.fn();
  const onKeep = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <LeaveFormDialog
      open
      onOpenChange={onOpenChange}
      title="Leave this booking?"
      onDiscard={onDiscard}
      onKeep={onKeep}
    />
  );
  return { onDiscard, onKeep, onOpenChange };
}

describe('LeaveFormDialog', () => {
  it('names what is being left', () => {
    setup();
    expect(screen.getByText('Leave this booking?')).toBeInTheDocument();
  });

  it('discards', async () => {
    const { onDiscard } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Discard it' }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it('keeps', async () => {
    const { onKeep } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Keep as draft' }));
    expect(onKeep).toHaveBeenCalledOnce();
  });

  it('goes back without destroying anything', async () => {
    const { onDiscard, onKeep, onOpenChange } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onKeep).not.toHaveBeenCalled();
  });
});
