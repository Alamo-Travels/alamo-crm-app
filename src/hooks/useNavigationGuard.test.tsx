import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { RouterProvider } from '@tanstack/react-router';
import { TEST_ROUTE_HERE, TEST_ROUTE_THERE, createTestRouter } from '@/test-utils/router';
import { useNavigationGuard } from './useNavigationGuard';

/** Renders the guard with a toggle for `when`, so a test can arm it after mount the way a real
 *  page does (nothing is unsaved until the user has actually done something). */
function Probe({ initiallyDirty }: { initiallyDirty: boolean }) {
  const [dirty, setDirty] = useState(initiallyDirty);
  const guard = useNavigationGuard(dirty);
  return (
    <div>
      <p data-testid="blocked">{guard.blocked ? 'blocked' : 'idle'}</p>
      <button type="button" onClick={() => setDirty(true)}>
        make dirty
      </button>
      <button type="button" onClick={() => setDirty(false)}>
        make clean
      </button>
      <button type="button" onClick={guard.proceed}>
        proceed
      </button>
      <button type="button" onClick={guard.reset}>
        reset
      </button>
    </div>
  );
}

/** Async because `RouterProvider` renders nothing until the router has finished loading — a
 *  synchronous helper hands back an empty document. */
async function renderGuard(initiallyDirty: boolean, history: 'memory' | 'browser' = 'memory') {
  const router = createTestRouter(<Probe initiallyDirty={initiallyDirty} />, { history });
  render(<RouterProvider router={router} />);
  await screen.findByTestId('blocked');
  return router;
}

describe('useNavigationGuard', () => {
  it('lets a navigation through untouched when there is nothing to lose', async () => {
    const router = await renderGuard(false);
    await waitFor(() => expect(router.state.location.pathname).toBe(TEST_ROUTE_HERE));

    await router.navigate({ to: TEST_ROUTE_THERE });

    await waitFor(() => expect(router.state.location.pathname).toBe(TEST_ROUTE_THERE));
    expect(screen.getByTestId('blocked')).toHaveTextContent('idle');
  });

  it('holds the navigation and reports blocked when there is unsaved work', async () => {
    const router = await renderGuard(true);
    await waitFor(() => expect(router.state.location.pathname).toBe(TEST_ROUTE_HERE));

    void router.navigate({ to: TEST_ROUTE_THERE });

    await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent('blocked'));
    expect(router.state.location.pathname).toBe(TEST_ROUTE_HERE);
  });

  it('lets the held navigation finish when proceed is called', async () => {
    const router = await renderGuard(true);
    void router.navigate({ to: TEST_ROUTE_THERE });
    await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent('blocked'));

    await userEvent.click(screen.getByRole('button', { name: 'proceed' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(TEST_ROUTE_THERE));
    expect(screen.getByTestId('blocked')).toHaveTextContent('idle');
  });

  it('cancels the held navigation and stays put when reset is called', async () => {
    const router = await renderGuard(true);
    void router.navigate({ to: TEST_ROUTE_THERE });
    await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent('blocked'));

    await userEvent.click(screen.getByRole('button', { name: 'reset' }));

    await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent('idle'));
    expect(router.state.location.pathname).toBe(TEST_ROUTE_HERE);
  });

  // The tab-close / reload half. jsdom never shows the native prompt, but `preventDefault` on a
  // cancelable beforeunload is exactly what asks the browser to show it, so that IS the
  // observable behaviour.
  // Needs a REAL browser history: createMemoryHistory registers no beforeunload listener at all,
  // so this test against memory history would pass while observing nothing.
  it('asks the browser to confirm a tab close only while there is unsaved work', async () => {
    await renderGuard(false, 'browser');

    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'make dirty' }));

    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  // Guards the ref indirection: the blocker registers once, but must read the LATEST value of
  // `when` rather than whatever it closed over at registration time.
  it('stops blocking once the work is saved, without a remount', async () => {
    const router = await renderGuard(true);
    await userEvent.click(screen.getByRole('button', { name: 'make clean' }));

    await router.navigate({ to: TEST_ROUTE_THERE });

    await waitFor(() => expect(router.state.location.pathname).toBe(TEST_ROUTE_THERE));
    expect(screen.getByTestId('blocked')).toHaveTextContent('idle');
  });
});
