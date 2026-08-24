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
 * A throwaway router wrapping one element, for component tests.
 *
 * Needed because a component that calls any TanStack Router hook — `useBlocker`, via
 * `useNavigationGuard` — throws outright when rendered without a `RouterProvider`. This is
 * deliberately NOT the real route tree from `router.tsx`: that one is guarded by auth/permission
 * `beforeLoad` redirects and would drag every page test into session setup. Tests that need the
 * real tree use `router.test.tsx`'s `renderApp` instead.
 *
 * The element hangs off the ROOT route, so it stays mounted across a navigation between the two
 * child paths below. That is what lets a blocker test observe "the navigation was held" rather
 * than "the component unmounted".
 */
/**
 * The two paths the throwaway router serves. They are deliberately REAL app paths: TanStack
 * Router's module augmentation in `router.tsx` types `navigate({ to })` against the registered
 * route tree globally, so a made-up path like '/there' type-checks fine under vitest but fails
 * `npm run build`. (This repo has been caught by exactly that gap before — a green test run is
 * not a type check.)
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
