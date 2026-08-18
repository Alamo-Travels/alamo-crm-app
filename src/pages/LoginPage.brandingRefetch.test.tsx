import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { vi } from 'vitest';
import { createAppRouter } from '../router';
import { useAuthStore, UserPermissions } from '../stores/authStore';
import * as authApi from '../api/auth.api';
import * as organizationApi from '../api/organization.api';

// The test below signs in and lands on /dashboard, which mounts AppShell — which now calls
// useEnquiryNotifications() → connectRealtime()/getSocket() from a real socket.io-client. Without
// this mock that would attempt a real socket connection in jsdom (AggregateError noise, no server
// to connect to).
vi.mock('../api/realtime', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

const PERMISSIONS: UserPermissions = {
  bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
  customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
  groups: { createShared: false },
  data: { viewReports: false },
  enquiries: { sendQuote: false, edit: false, delete: false },
};

function renderAtLogin() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/login'] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

/**
 * `GET /organization/branding` now withholds `invoiceTerms` from anonymous callers, so the copy
 * cached while the login page was on screen is deliberately incomplete. Without an explicit
 * refetch on sign-in that stale, terms-less entry would satisfy `useBranding` for its full
 * 4-minute staleTime — long enough for the send-invoice dialog to open with empty terms.
 */
describe('LoginPage refreshes cached branding after sign-in', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, sessionRestoreAttempted: false });
    vi.spyOn(authApi, 'refreshRequest').mockRejectedValue(new Error('no session'));
    vi.spyOn(organizationApi, 'getBranding').mockResolvedValue({
      name: 'Alamo Travels', tagline: 'Internal CRM', logoUrl: null, invoiceTerms: null, timeZone: 'America/Chicago',
    });
    vi.spyOn(authApi, 'loginRequest').mockResolvedValue({
      accessToken: 'token',
      user: { id: 'u1', name: 'Agent', email: 'a@a.test', role: 'agent', permissions: PERMISSIONS },
    });
  });

  it('refetches branding once the session is established', async () => {
    renderAtLogin();
    await screen.findByRole('img', { name: 'Alamo Travels' });

    const callsBeforeLogin = vi.mocked(organizationApi.getBranding).mock.calls.length;

    await userEvent.type(screen.getByLabelText('Email'), 'a@a.test');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(vi.mocked(organizationApi.getBranding).mock.calls.length).toBeGreaterThan(callsBeforeLogin);
    });
  });
});
