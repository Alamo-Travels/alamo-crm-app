// src/pages/LoginPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { vi } from 'vitest';
import { createAppRouter } from '../router';
import { useAuthStore } from '../stores/authStore';
import * as authApi from '../api/auth.api';
import * as organizationApi from '../api/organization.api';

// A successful login below navigates to /dashboard, which mounts AppShell — which now calls
// useEnquiryNotifications() → connectRealtime()/getSocket() from a real socket.io-client. Without
// this mock that test would attempt a real socket connection in jsdom (AggregateError noise, no
// server to connect to).
vi.mock('../api/realtime', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

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

describe('LoginPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, sessionRestoreAttempted: false });
    vi.spyOn(authApi, 'refreshRequest').mockRejectedValue(new Error('no session'));
    vi.spyOn(organizationApi, 'getBranding').mockResolvedValue({ name: 'Alamo Travels', tagline: 'Internal CRM', logoUrl: null, invoiceTerms: null, timeZone: 'America/Chicago' });
  });

  it('shows the Alamo Travels logo', async () => {
    renderAtLogin();
    expect(await screen.findByRole('img', { name: 'Alamo Travels' })).toBeInTheDocument();
  });

  it('falls back to the default branding if the branding fetch fails', async () => {
    vi.spyOn(organizationApi, 'getBranding').mockRejectedValue(new Error('network error'));
    renderAtLogin();
    expect(await screen.findByRole('img', { name: 'Alamo Travels' })).toBeInTheDocument();
    expect(screen.getByText('Internal CRM')).toBeInTheDocument();
  });

  it('shows a custom org name, tagline, and logo once branding loads', async () => {
    vi.spyOn(organizationApi, 'getBranding').mockResolvedValue({
      name: 'Acme Travel', tagline: 'Custom Tagline', logoUrl: 'https://signed.example.com/logo.png', invoiceTerms: null, timeZone: 'America/Chicago',
    });
    renderAtLogin();
    expect(await screen.findByRole('img', { name: 'Acme Travel' })).toHaveAttribute('src', 'https://signed.example.com/logo.png');
    expect(screen.getByText('Custom Tagline')).toBeInTheDocument();
  });

  it('logs in, stores the session, and navigates to /dashboard', async () => {
    vi.spyOn(authApi, 'loginRequest').mockResolvedValue({
      accessToken: 'token-123',
      user: { id: '1', name: 'Admin', email: 'admin@alamo.test', role: 'admin' },
    });
    const router = renderAtLogin();
    await screen.findByRole('heading', { name: 'Sign in' });

    await userEvent.type(screen.getByLabelText('Email'), 'admin@alamo.test');
    await userEvent.type(screen.getByLabelText('Password'), 'supersecret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe('token-123');
      expect(router.state.location.pathname).toBe('/dashboard');
    });
  });

  it('shows an error message on invalid credentials and stays on /login', async () => {
    vi.spyOn(authApi, 'loginRequest').mockRejectedValue(new Error('Invalid'));
    const router = renderAtLogin();
    await screen.findByRole('heading', { name: 'Sign in' });

    await userEvent.type(screen.getByLabelText('Email'), 'admin@alamo.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('tells a deactivated user their account is deactivated, not that their password is wrong', async () => {
    vi.spyOn(authApi, 'loginRequest').mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 403,
        data: {
          error: {
            code: 'ACCOUNT_DEACTIVATED',
            message: 'Your account has been deactivated. Contact an administrator.',
          },
        },
      },
    });
    const router = renderAtLogin();
    await screen.findByRole('heading', { name: 'Sign in' });

    await userEvent.type(screen.getByLabelText('Email'), 'admin@alamo.test');
    await userEvent.type(screen.getByLabelText('Password'), 'supersecret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Your account has been deactivated. Contact an administrator.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Invalid email or password')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});
