import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { vi } from 'vitest';
import { createAppRouter } from '../router';
import { useAuthStore } from '../stores/authStore';
import * as authApi from '../api/auth.api';
import * as organizationApi from '../api/organization.api';
import { clearAllDrafts, readDraft, writeDraft } from '../utils/formDraft';

function renderAuthedApp(initialPath: string) {
  useAuthStore.setState({
    accessToken: 't',
    user: { id: '1', name: 'Admin User', email: 'admin@alamo.test', role: 'admin' },
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialPath] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

describe('AppShell', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, sessionRestoreAttempted: false });
    vi.spyOn(authApi, 'refreshRequest').mockRejectedValue(new Error('no session'));
    vi.spyOn(organizationApi, 'getBranding').mockResolvedValue({ name: 'Alamo Travels', tagline: 'Internal CRM', logoUrl: null, invoiceTerms: null, timeZone: 'America/Chicago' });
  });

  it('shows sidebar links and the signed-in user', async () => {
    renderAuthedApp('/customers');
    expect(await screen.findByRole('img', { name: 'Alamo Travels' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bookings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByText('Admin User')).toBeInTheDocument();
  });

  it('shows the profile photo instead of initials in the account menu trigger when photoUrl is set', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: {
        id: '1', name: 'Admin User', email: 'admin@alamo.test', role: 'admin',
        photoUrl: 'https://signed.example.com/avatar.jpg',
      },
    });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/customers'] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    await screen.findByRole('link', { name: 'Dashboard' });
    expect(screen.getByRole('img', { name: 'Admin User' })).toHaveAttribute('src', 'https://signed.example.com/avatar.jpg');
  });

  it('hides the Sales link from an agent without data.viewReports', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: {
        id: '2', name: 'Agent', email: 'agent@alamo.test', role: 'agent',
        permissions: {
          bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
          customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
          groups: { createShared: false },
          data: { viewReports: false },
          enquiries: { sendQuote: false, edit: false, delete: false },
        },
      },
    });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/customers'] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    await screen.findByRole('link', { name: 'Dashboard' });
    expect(screen.queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();
  });

  it('shows the Users link to an admin', async () => {
    renderAuthedApp('/customers');
    expect(await screen.findByRole('link', { name: 'Users' })).toBeInTheDocument();
  });

  it('hides the Users link from an agent', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: '2', name: 'G', email: 'g@t.test', role: 'agent' },
    });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/customers'] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    await screen.findByRole('link', { name: 'Dashboard' });
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('shows the Audit log link to an admin', async () => {
    renderAuthedApp('/customers');
    expect(await screen.findByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });

  it('hides the Audit log link from an agent', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: '2', name: 'G', email: 'g@t.test', role: 'agent' },
    });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/customers'] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    await screen.findByRole('link', { name: 'Dashboard' });
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('highlights the current page in the sidebar and updates on navigation', async () => {
    const router = renderAuthedApp('/customers');
    await screen.findByRole('link', { name: 'Customers' });
    expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('data-active', 'false');

    await userEvent.click(screen.getByRole('link', { name: 'Bookings' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/bookings');
    });
    expect(screen.getByRole('link', { name: 'Bookings' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute('data-active', 'false');
  });

  it('navigates between pages via sidebar links', async () => {
    const router = renderAuthedApp('/customers');
    await screen.findByRole('link', { name: 'Bookings' });
    await userEvent.click(screen.getByRole('link', { name: 'Bookings' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/bookings');
    });
  });

  it('opens the account menu and navigates to Settings', async () => {
    const router = renderAuthedApp('/customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings');
    });
  });

  it('offers a theme control in the account menu', async () => {
    renderAuthedApp('/customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText('Theme')).toBeInTheDocument();
  });

  it('signs out and redirects to /login', async () => {
    const logout = vi.spyOn(authApi, 'logoutRequest').mockResolvedValue(undefined);
    const router = renderAuthedApp('/customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
      expect(useAuthStore.getState().user).toBeNull();
      expect(router.state.location.pathname).toBe('/login');
    });
  });

  it("sign-out clears the signing-out user's drafts but not a colleague's", async () => {
    localStorage.clear();
    vi.spyOn(authApi, 'logoutRequest').mockResolvedValue(undefined);
    writeDraft('1', 'customer', { form: { firstName: 'Mine' } });
    writeDraft('99', 'customer', { form: { firstName: 'Theirs' } });

    renderAuthedApp('/customers');
    await screen.findByRole('link', { name: 'Dashboard' });

    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(readDraft('1', 'customer')).toBeNull());
    expect(readDraft('99', 'customer')).not.toBeNull();

    clearAllDrafts('99'); // don't leak into the next test in this file
  });
});
