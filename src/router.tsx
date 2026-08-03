import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CustomersPage from './pages/CustomersPage';
import BookingsPage from './pages/BookingsPage';
import EnquiriesPage from './pages/EnquiriesPage';
import EnquiryDetailPage from './pages/EnquiryDetailPage';
import GroupsPage from './pages/GroupsPage';
import GroupResultsPage from './pages/GroupResultsPage';
import GroupEditorPage from './pages/GroupEditorPage';
import WidgetEditorPage from './pages/WidgetEditorPage';
import SalesPage from './pages/SalesPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import { AuditPage } from './pages/AuditPage';
import AppShell from './components/AppShell';
import { Toaster } from './components/ui/sonner';
import { useAuthStore } from './stores/authStore';
import { canViewSalesReports, canManageUsers, canViewAudit, canCreateBookings } from './utils/permissions';
import { restoreSession } from './api/sessionRestore';

const rootRoute = createRootRoute({
  beforeLoad: () => restoreSession(),
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
  pendingComponent: () => <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">Loading…</div>,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: useAuthStore.getState().user ? '/dashboard' : '/login' });
  },
});

export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: () => {
    if (!useAuthStore.getState().user) {
      throw redirect({ to: '/login' });
    }
  },
  component: AppShell,
});

const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/dashboard',
  component: DashboardPage,
});

const widgetNewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/dashboard/widgets/new',
  // `template` picks a starter from the widget-template gallery (undefined = show the gallery).
  validateSearch: (search: Record<string, unknown>): { template?: string } => ({
    template: typeof search.template === 'string' ? search.template : undefined,
  }),
  component: WidgetEditorPage,
});

const widgetEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/dashboard/widgets/$widgetId',
  component: WidgetEditorPage,
});

const customersRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/customers',
  component: CustomersPage,
});

const bookingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/bookings',
  component: BookingsPage,
});

const invoiceScanRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/bookings/scan',
  // Gated on canCreateBookings, not bookings.import — saving a scanned invoice goes through
  // POST /api/bookings (bookings.create), and bookings.import is one of the four keys a plain
  // Admin does not get for free. Requiring it here would lock Admins out of a tool that does
  // nothing they cannot already do one invoice at a time.
  beforeLoad: () => {
    if (!canCreateBookings(useAuthStore.getState().user)) {
      throw redirect({ to: '/bookings' });
    }
  },
  // Lazy-loaded (unlike every other route component here) because InvoiceScanPage transitively
  // imports pdfjs-dist, whose browser build references DOMMatrix at module-evaluation time —
  // jsdom doesn't implement DOMMatrix, so a plain static import would crash on load in every test
  // that renders the full router without navigating to this route (router.test.tsx, AppShell,
  // DashboardPage, LoginPage, etc. all render RouterProvider). Deferring the import until this
  // route actually loads keeps pdfjs-dist out of those test runs entirely, and is a genuine win
  // for the real app too — pdfjs-dist + tesseract.js are heavy and most sessions never scan a PDF.
  component: lazyRouteComponent(() => import('./pages/InvoiceScanPage')),
});

const salesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/sales',
  beforeLoad: () => {
    if (!canViewSalesReports(useAuthStore.getState().user)) {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: SalesPage,
});

const enquiriesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/enquiries',
  component: EnquiriesPage,
});

const enquiryDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/enquiries/$enquiryId',
  component: EnquiryDetailPage,
});

const groupsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/groups',
  component: GroupsPage,
});

const groupNewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/groups/new',
  component: GroupEditorPage,
});

const groupResultsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/groups/$groupId',
  component: GroupResultsPage,
});

const groupEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/groups/$groupId/edit',
  component: GroupEditorPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: SettingsPage,
});

const usersRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/users',
  beforeLoad: () => {
    if (!canManageUsers(useAuthStore.getState().user)) {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: UsersPage,
});

const auditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/audit',
  beforeLoad: () => {
    if (!canViewAudit(useAuthStore.getState().user)) {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: AuditPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  indexRoute,
  authedRoute.addChildren([dashboardRoute, widgetNewRoute, widgetEditRoute, customersRoute, bookingsRoute, invoiceScanRoute, salesRoute, enquiriesRoute, enquiryDetailRoute, groupsRoute, groupNewRoute, groupResultsRoute, groupEditRoute, settingsRoute, usersRoute, auditRoute]),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
