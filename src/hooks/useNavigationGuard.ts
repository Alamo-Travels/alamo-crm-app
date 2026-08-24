import { useCallback, useRef } from 'react';
import { useBlocker } from '@tanstack/react-router';

export interface NavigationGuard {
  /** True while a navigation is being held, waiting for the user to answer. */
  blocked: boolean;
  /** Let the held navigation finish. */
  proceed: () => void;
  /** Cancel the held navigation and stay where we are. */
  reset: () => void;
}

/**
 * Holds a navigation until the user confirms, whenever `when` is true.
 *
 * Covers every way out of a page through ONE registration:
 *  - an in-app `<Link>` or `navigate()` (a history PUSH/REPLACE);
 *  - the browser's Back/Forward buttons and a mouse's back button (a POP — `@tanstack/history`
 *    restores the URL with `go(1)` after a blocked pop, so the address bar does not drift);
 *  - closing the tab, reloading, or typing another URL (`beforeunload`, which shows the
 *    browser's own prompt — its wording is not ours to set).
 *
 * `enableBeforeUnload` is passed as a FUNCTION, never a bare `true`. As a constant it would make
 * every reload of the page prompt, including one with nothing to lose.
 *
 * Both callbacks read `when` through a ref and are `useCallback`-stable, so the blocker registers
 * once and then reads the current value on each navigation. Passing `when` directly would give
 * `shouldBlockFn` a new identity on every render, and `useBlocker` lists it in its effect deps —
 * so the history blocker would be torn down and re-registered on every render of the host page.
 */
export function useNavigationGuard(when: boolean): NavigationGuard {
  const whenRef = useRef(when);
  whenRef.current = when;

  const shouldBlockFn = useCallback(() => whenRef.current, []);
  const enableBeforeUnload = useCallback(() => whenRef.current, []);

  const { status, proceed, reset } = useBlocker({
    shouldBlockFn,
    enableBeforeUnload,
    withResolver: true,
  });

  const blocked = status === 'blocked';

  // `proceed`/`reset` are undefined while idle (the resolver only carries them for a live block).
  // Callers render a dialog off `blocked`, so they would never fire then — but a no-op is a
  // kinder contract than an optional call signature at every call site.
  const noop = useCallback(() => undefined, []);

  return {
    blocked,
    proceed: proceed ?? noop,
    reset: reset ?? noop,
  };
}
