import { ReactNode } from 'react';
import {
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

/**
 * A throwaway router wrapping one element, for component tests. Needed because any TanStack Router
 * hook throws outside a `RouterProvider`.
 *
 * Deliberately NOT the real route tree, which is guarded by auth `beforeLoad` redirects and would
 * drag every page test into session setup; tests needing it use `router.test.tsx`'s `renderApp`.
 *
 * The element hangs off the ROOT route so it stays mounted across a navigation, which is what lets
 * a blocker test observe "the navigation was held" rather than "the component unmounted".
 */
/**
 * Deliberately REAL app paths: module augmentation types `navigate({ to })` against the registered
 * route tree globally, so a made-up path type-checks under vitest but fails `npm run build`.
 */
export const TEST_ROUTE_HERE = '/bookings/scan';
export const TEST_ROUTE_THERE = '/bookings';

export interface TestRouterOptions {
  initialPath?: string;
  /**
   * `'memory'` (the default) suits anything that only navigates in-app.
   *
   * Use `'browser'` ONLY to exercise `beforeunload`: `createMemoryHistory` never registers a
   * `beforeunload` listener at all (only `createBrowserHistory` does), so a tab-close test against
   * memory history silently passes for the wrong reason — it observes nothing, because there is
   * nothing to observe.
   */
  history?: 'memory' | 'browser';
}

export function createTestRouter(element: ReactNode, options: TestRouterOptions = {}) {
  const { initialPath = TEST_ROUTE_HERE, history = 'memory' } = options;
  const rootRoute = createRootRoute({ component: () => <>{element}</> });
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const here = createRoute({ getParentRoute: () => rootRoute, path: TEST_ROUTE_HERE, component: () => null });
  const there = createRoute({ getParentRoute: () => rootRoute, path: TEST_ROUTE_THERE, component: () => null });

  return createRouter({
    routeTree: rootRoute.addChildren([index, here, there]),
    history:
      history === 'browser'
        ? createBrowserHistory()
        : createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

/** `createTestRouter` plus its provider, for the common case of "I just need router context". */
export function withTestRouter(element: ReactNode, options: TestRouterOptions = {}) {
  const router = createTestRouter(element, options);
  return { router, ui: <RouterProvider router={router} /> };
}
