import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../router';
import { useAuthStore } from '../stores/authStore';
import * as enquiriesApi from '../api/enquiries.api';

vi.mock('../api/enquiries.api', async (importActual) => ({
  ...(await importActual<typeof enquiriesApi>()),
  getUnreadEnquiryCount: vi.fn(),
  listEnquiries: vi.fn().mockResolvedValue({ enquiries: [], total: 0, page: 1, pageSize: 25 }),
}));

// AppShell now mounts useEnquiryNotifications(), which calls connectRealtime()/getSocket() from a
// real socket.io-client — without this mock every test here would attempt a real socket connection
// in jsdom (AggregateError noise, no server to connect to).
vi.mock('../api/realtime', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/dashboard'] }));
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('AppShell enquiries badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      accessToken: 'token',
      sessionRestoreAttempted: true,
      user: {
        id: 'u1', name: 'Agent', email: 'a@alamo.test', role: 'agent',
        photoUrl: null, permissions: undefined,
      },
    });
  });

  it('shows the count and announces it on the Enquiries link', async () => {
    vi.mocked(enquiriesApi.getUnreadEnquiryCount).mockResolvedValue(7);
    renderShell();
    expect(await screen.findByText('7')).toBeInTheDocument();
    // A function matcher, not a fixed-spacing regex: jsdom's accessible-name computation inserts
    // a phantom space around sibling <span> elements (no stylesheet is loaded in tests, so
    // getComputedStyle reports an empty `display` for an unstyled span, which the accname
    // algorithm treats as non-inline) — real browsers don't do this. Checking both substrings
    // independently tolerates that artifact while still proving the count reaches the SAME
    // link's computed accessible name — it would fail if the sr-only count span were removed.
    expect(
      screen.getByRole('link', {
        name: (accessibleName) => accessibleName.includes('Enquiries') && accessibleName.includes('7 new'),
      })
    ).toBeInTheDocument();
  });

  it('renders no badge at all when nothing is waiting', async () => {
    vi.mocked(enquiriesApi.getUnreadEnquiryCount).mockResolvedValue(0);
    renderShell();
    // The link resolves without the suffix, and there is no stray "0".
    await waitFor(() => expect(screen.getByRole('link', { name: 'Enquiries' })).toBeInTheDocument());
    expect(screen.queryByTestId('enquiries-unread-badge')).not.toBeInTheDocument();
  });
});
