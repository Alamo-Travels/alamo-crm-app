// src/pages/DashboardPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { vi } from 'vitest';
import { createAppRouter } from '../router';
import { reorder } from '../components/dashboard/reorder';
import { useAuthStore } from '../stores/authStore';
import * as widgetsApi from '../api/widgets.api';
import * as usersApi from '../api/users.api';

// AppShell now mounts useEnquiryNotifications(), which calls connectRealtime()/getSocket() from a
// real socket.io-client — without this mock every test here would attempt a real socket connection
// in jsdom (AggregateError noise, no server to connect to).
vi.mock('../api/realtime', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

function renderAtDashboard() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/dashboard'] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

const W1 = {
  id: 'w1', name: 'QR count', owner: { id: 'u1', name: 'Admin' },
  sharedWith: { mode: 'private' as const, users: [] }, vizType: 'number' as const,
  aggregation: { fn: 'count' as const }, hasInlineConditions: true, period: 'all' as const, updatedAt: '2026-07-06T00:00:00.000Z',
};
const W2 = {
  id: 'w2', name: 'By airline', owner: { id: 'u1', name: 'Admin' },
  sharedWith: { mode: 'private' as const, users: [] }, vizType: 'table' as const,
  aggregation: { fn: 'count' as const, groupBy: 'airlineCode' }, hasInlineConditions: true, period: 'all' as const, updatedAt: '2026-07-05T00:00:00.000Z',
};

describe('DashboardPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: 't', user: { id: 'u1', name: 'Admin', email: 'a@t.test', role: 'admin' } });
    vi.spyOn(usersApi, 'getUserDirectory').mockResolvedValue([{ id: 'u1', name: 'Admin' }]);
  });

  it('renders cards in layout order and shows their data', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [W1, W2],
      layout: [{ widget: 'w2', order: 0, size: 'small' }, { widget: 'w1', order: 1, size: 'small' }],
    });
    // Distinct values per widget so each is unambiguously assertable. (They used to both be 7,
    // which made `findByText('7')` throw "Found multiple elements" whenever both async widget
    // loads resolved in the same tick — a race that stayed hidden in isolation but surfaced
    // reliably under full-suite CPU contention.)
    vi.spyOn(widgetsApi, 'getWidgetData').mockImplementation(async (id) =>
      id === 'w1' ? { kind: 'scalar', value: 42 } : { kind: 'breakdown', rows: [{ key: 'QR', value: 7 }] }
    );
    renderAtDashboard();

    expect(await screen.findByRole('heading', { name: 'By airline' })).toBeInTheDocument();
    expect(await screen.findByText('42')).toBeInTheDocument(); // scalar widget's data
    expect(await screen.findByText('7')).toBeInTheDocument(); // table widget's data
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['By airline', 'QR count']);
  });

  // The reorder logic itself — both a mouse drop and a keyboard drop route through this pure
  // function. (The full drag interaction needs real element rects that jsdom doesn't provide, so
  // it's browser-verified; here we pin the ordering math and, below, the a11y-reachable handle.)
  it('reorder() moves the dragged id to the drop position', () => {
    expect(reorder(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorder(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c']); // no-op
    expect(reorder(['a', 'b', 'c'], 'x', 'a')).toEqual(['a', 'b', 'c']); // unknown id → unchanged
  });

  it('gives every card a keyboard-reachable drag handle', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [W1, W2],
      layout: [{ widget: 'w1', order: 0, size: 'small' }, { widget: 'w2', order: 1, size: 'small' }],
    });
    vi.spyOn(widgetsApi, 'getWidgetData').mockResolvedValue({ kind: 'scalar', value: 1 });
    renderAtDashboard();

    const handle = await screen.findByRole('button', { name: 'Drag QR count to reorder' });
    expect(handle).toBeInTheDocument();
    handle.focus();
    expect(handle).toHaveFocus(); // a keyboard user can reach and lift it
  });

  it('persists the layout when a widget is resized', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [W1, W2],
      layout: [{ widget: 'w1', order: 0, size: 'small' }, { widget: 'w2', order: 1, size: 'small' }],
    });
    vi.spyOn(widgetsApi, 'getWidgetData').mockResolvedValue({ kind: 'scalar', value: 1 });
    const save = vi.spyOn(widgetsApi, 'saveLayout').mockResolvedValue();
    renderAtDashboard();

    await screen.findByRole('heading', { name: 'QR count' });
    await userEvent.click(screen.getByRole('button', { name: 'Resize QR count' }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([
        { widget: 'w1', order: 0, size: 'large' },
        { widget: 'w2', order: 1, size: 'small' },
      ])
    );
  });

  it('toasts and reverts when the layout save fails', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [W1, W2],
      layout: [{ widget: 'w1', order: 0, size: 'small' }, { widget: 'w2', order: 1, size: 'small' }],
    });
    vi.spyOn(widgetsApi, 'getWidgetData').mockResolvedValue({ kind: 'scalar', value: 1 });
    vi.spyOn(widgetsApi, 'saveLayout').mockRejectedValue(new Error('network'));
    renderAtDashboard();

    await screen.findByRole('heading', { name: 'QR count' });
    // Resize goes through the same persist → save path a drop does.
    await userEvent.click(screen.getByRole('button', { name: 'Resize QR count' }));

    const toastText = await screen.findByText(/could not save/i);
    expect(toastText).toBeInTheDocument();
    // Pins the destructive styling path structurally — jsdom never applies sonner's injected
    // stylesheet, so this is the closest we can assert without a real browser: sonner marks an
    // error toast with data-type="error", which is what its CSS keys the destructive palette off.
    expect(toastText.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');

    // The board must snap back to what the server actually holds: the resize is undone, so the
    // button reads "Large" again (i.e. the widget is back to small).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resize QR count' })).toHaveAttribute('title', 'Large')
    );
  });

  it('toasts when deleting a widget fails', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [W1, W2],
      layout: [{ widget: 'w1', order: 0, size: 'small' }, { widget: 'w2', order: 1, size: 'small' }],
    });
    vi.spyOn(widgetsApi, 'getWidgetData').mockResolvedValue({ kind: 'scalar', value: 1 });
    vi.spyOn(widgetsApi, 'deleteWidget').mockRejectedValue(new Error('network'));
    renderAtDashboard();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete QR count' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));

    const toastText = await screen.findByText(/could not delete/i);
    expect(toastText).toBeInTheDocument();
    // Same structural pin as the layout-save toast above: jsdom can't apply sonner's stylesheet, so
    // the closest assertion that the destructive palette would render is the data-type attribute.
    expect(toastText.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');
  });

  it('reverts to the last server-confirmed layout (not the page-load layout) after two successful saves then a failed one', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [W1, W2],
      layout: [{ widget: 'w1', order: 0, size: 'small' }, { widget: 'w2', order: 1, size: 'small' }],
    });
    vi.spyOn(widgetsApi, 'getWidgetData').mockResolvedValue({ kind: 'scalar', value: 1 });
    const save = vi.spyOn(widgetsApi, 'saveLayout');
    save.mockClear();
    save
      .mockResolvedValueOnce(undefined) // 1st save succeeds: resize QR count to large
      .mockResolvedValueOnce(undefined) // 2nd save succeeds: resize By airline to large
      .mockRejectedValueOnce(new Error('network')); // 3rd save fails
    renderAtDashboard();

    await screen.findByRole('heading', { name: 'QR count' });

    // 1st successful save: QR count -> large. Button flips to "Small".
    await userEvent.click(screen.getByRole('button', { name: 'Resize QR count' }));
    expect(await screen.findByRole('button', { name: 'Resize QR count' })).toHaveAttribute('title', 'Small');

    // 2nd successful save: By airline -> large. This is the state the `confirmed` ref must hold
    // now -- distinct from BOTH the page-load layout and the state after save #1 alone.
    await userEvent.click(screen.getByRole('button', { name: 'Resize By airline' }));
    expect(await screen.findByRole('button', { name: 'Resize By airline' })).toHaveAttribute('title', 'Small');

    // 3rd save fails: attempt QR count -> small.
    await userEvent.click(screen.getByRole('button', { name: 'Resize QR count' }));
    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();

    // Must land on the last SERVER-CONFIRMED state: BOTH widgets large. A `confirmed` ref seeded
    // only once at mount (i.e. a deleted onSuccess handler) would wrongly revert QR count to small,
    // flipping its button back to "Large".
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resize QR count' })).toHaveAttribute('title', 'Small')
    );
    expect(screen.getByRole('button', { name: 'Resize By airline' })).toHaveAttribute('title', 'Small');
  });

  it('deletes a widget after confirmation', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [W1], layout: [{ widget: 'w1', order: 0, size: 'small' }],
    });
    vi.spyOn(widgetsApi, 'getWidgetData').mockResolvedValue({ kind: 'scalar', value: 1 });
    const del = vi.spyOn(widgetsApi, 'deleteWidget').mockResolvedValue();
    renderAtDashboard();

    await screen.findByRole('heading', { name: 'QR count' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete QR count' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('w1'));
  });

  it("shows each widget's period on its card, so a bare number is never ambiguous", async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [{ ...W1, period: 'thisMonth' }],
      layout: [{ widget: 'w1', order: 0, size: 'small' }],
    });
    vi.spyOn(widgetsApi, 'getWidgetData').mockResolvedValue({ kind: 'scalar', value: 7 });
    renderAtDashboard();
    expect(await screen.findByText('This month')).toBeInTheDocument();
  });

  it('shows no period label on an all-time widget', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [W1],
      layout: [{ widget: 'w1', order: 0, size: 'small' }],
    });
    vi.spyOn(widgetsApi, 'getWidgetData').mockResolvedValue({ kind: 'scalar', value: 7 });
    renderAtDashboard();
    await screen.findByRole('heading', { name: 'QR count' });
    expect(screen.queryByText('All time')).not.toBeInTheDocument();
  });

  it('shows the template gallery inline on an empty dashboard', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({ widgets: [], layout: [] });
    renderAtDashboard();
    expect(await screen.findByText(/pick a starting point/i)).toBeInTheDocument();
    expect(screen.getByText('Revenue this month')).toBeInTheDocument();
    expect(screen.getByText('Blank widget')).toBeInTheDocument();
  });

  it('opens the gallery from New widget and navigates to the editor with the chosen template', async () => {
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({
      widgets: [W1], layout: [{ widget: 'w1', order: 0, size: 'small' }],
    });
    vi.spyOn(widgetsApi, 'getWidgetData').mockResolvedValue({ kind: 'scalar', value: 1 });
    vi.spyOn(widgetsApi, 'getDimensions').mockResolvedValue([]);
    vi.spyOn(widgetsApi, 'getWidget').mockResolvedValue({} as never);
    const router = renderAtDashboard();

    await screen.findByRole('heading', { name: 'QR count' });
    await userEvent.click(screen.getByRole('button', { name: 'New widget' }));
    // The gallery card in the dialog:
    await userEvent.click(await screen.findByText('Bookings by airline'));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard/widgets/new');
      expect(router.state.location.search).toEqual({ template: 'bookings-by-airline' });
    });
  });
});
