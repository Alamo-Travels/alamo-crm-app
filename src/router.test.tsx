// src/router.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { vi } from 'vitest';
import { createAppRouter } from './router';
import { useAuthStore } from './stores/authStore';
import * as authApi from './api/auth.api';

function renderApp(initialPath: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialPath] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

describe('app router', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, sessionRestoreAttempted: false });
  });

  it('redirects unauthenticated /customers to /login', async () => {
    vi.spyOn(authApi, 'refreshRequest').mockRejectedValue(new Error('no session'));
    const router = renderApp('/customers');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('restores an existing session from the refresh cookie on boot, instead of bouncing to /login', async () => {
    vi.spyOn(authApi, 'refreshRequest').mockResolvedValue({ accessToken: 'restored-token' });
    vi.spyOn(authApi, 'meRequest').mockResolvedValue({
      id: '1', name: 'Admin', email: 'a@alamo.test', role: 'admin',
    });
    const router = renderApp('/customers');
    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/customers');
    expect(useAuthStore.getState().accessToken).toBe('restored-token');
    expect(useAuthStore.getState().user).toMatchObject({ id: '1', name: 'Admin' });
  });

  it('renders the customers page at /customers when signed in', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: '1', name: 'Admin', email: 'a@alamo.test', role: 'admin' },
    });
    renderApp('/customers');
    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
  });

  it('redirects / to /dashboard when signed in', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: '1', name: 'Admin', email: 'a@alamo.test', role: 'admin' },
    });
    const router = renderApp('/');
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(router.state.location.pathname).toBe('/dashboard');
  });

  it('redirects an agent without data.viewReports away from /sales', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: {
        id: '1', name: 'Agent', email: 'a@alamo.test', role: 'agent',
        permissions: {
          bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
          customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
          groups: { createShared: false },
          data: { viewReports: false },
          enquiries: { sendQuote: false, edit: false, delete: false },
        },
      },
    });
    const router = renderApp('/sales');
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(router.state.location.pathname).toBe('/dashboard');
  });

  // The scan page writes bookings, so it is gated on `bookings.create` — deliberately NOT
  // `bookings.import`, which is ADMIN_RESTRICTED and would lock a plain Admin out of a feature
  // they are otherwise entitled to use. Nothing tested this gate (final review, item 11).
  it('redirects an agent without bookings.create away from /bookings/scan', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: {
        id: '1', name: 'Agent', email: 'a@alamo.test', role: 'agent',
        permissions: {
          bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
          customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
          groups: { createShared: false },
          data: { viewReports: false },
          enquiries: { sendQuote: false, edit: false, delete: false },
        },
      },
    });
    const router = renderApp('/bookings/scan');
    await waitFor(() => expect(router.state.location.pathname).not.toBe('/bookings/scan'));
    // Lands on the bookings LIST, not /dashboard — reads are ungated in this app by design, so the
    // nearest page this agent may still use is the right destination.
    expect(router.state.location.pathname).toBe('/bookings');
  });

  // The positive half matters as much as the negative one: an agent holding ONLY `bookings.create`
  // — no `import`, no `export` — must still reach the page, which is the whole reason the gate is
  // `create` rather than `import`.
  it('lets an agent with only bookings.create reach /bookings/scan', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: {
        id: '1', name: 'Agent', email: 'a@alamo.test', role: 'agent',
        permissions: {
          bookings: { create: true, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
          customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
          groups: { createShared: false },
          data: { viewReports: false },
          enquiries: { sendQuote: false, edit: false, delete: false },
        },
      },
    });
    const router = renderApp('/bookings/scan');
    await waitFor(() => expect(router.state.location.pathname).toBe('/bookings/scan'));
  });

  it('lets an admin view /sales', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: '1', name: 'Admin', email: 'a@alamo.test', role: 'admin' },
    });
    renderApp('/sales');
    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeInTheDocument();
  });

  it('redirects an agent without a manage-users/admin role away from /audit', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: {
        id: '1', name: 'Agent', email: 'a@alamo.test', role: 'agent',
        permissions: {
          bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
          customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
          groups: { createShared: false },
          data: { viewReports: false },
          enquiries: { sendQuote: false, edit: false, delete: false },
        },
      },
    });
    const router = renderApp('/audit');
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(router.state.location.pathname).toBe('/dashboard');
  });

  it('lets an admin view /audit', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: '1', name: 'Admin', email: 'a@alamo.test', role: 'admin' },
    });
    renderApp('/audit');
    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
  });
});
