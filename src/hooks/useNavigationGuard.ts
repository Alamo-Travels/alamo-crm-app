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
 * Holds a navigation until the user confirms, whenever `when` is true. One registration covers
 * in-app links and `navigate()`, browser and mouse Back/Forward (a blocked POP is undone with
 * `go(1)`, so the address bar does not drift), and tab close or reload via `beforeunload`.
 *
 * `enableBeforeUnload` is a FUNCTION, never a bare `true` — as a constant, every reload prompts,
 * including one with nothing to lose.
 *
 * Both callbacks read `when` through a ref and are `useCallback`-stable so the blocker registers
 * once. Passing `when` directly would give `shouldBlockFn` a new identity every render, and
 * `useBlocker` lists it in its effect deps, tearing down and re-registering the blocker each time.
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
