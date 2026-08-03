import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DraftRestoreBar } from './draft-restore-bar';

describe('DraftRestoreBar', () => {
  it('shows when the draft was saved', () => {
    const savedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(<DraftRestoreBar savedAt={savedAt} onRestore={() => {}} onDiscard={() => {}} />);
    expect(screen.getByText(/unfinished draft from 2 hours ago/i)).toBeInTheDocument();
  });

  it('renders an optional note', () => {
    render(
      <DraftRestoreBar
        savedAt={new Date().toISOString()}
        note="Passport file scan.pdf was not saved — re-attach it."
        onRestore={() => {}}
        onDiscard={() => {}}
      />
    );
    expect(screen.getByText(/scan\.pdf was not saved/i)).toBeInTheDocument();
  });

  it('calls onRestore and onDiscard', async () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    const user = userEvent.setup();
    render(
      <DraftRestoreBar savedAt={new Date().toISOString()} onRestore={onRestore} onDiscard={onDiscard} />
    );

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });
});
