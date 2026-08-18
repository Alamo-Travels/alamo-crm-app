import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { vi } from 'vitest';
import { createAppRouter } from '../router';
import { useAuthStore, AuthUser } from '../stores/authStore';
import * as widgetsApi from '../api/widgets.api';
import * as groupsApi from '../api/groups.api';
import * as usersApi from '../api/users.api';

// AppShell now mounts useEnquiryNotifications(), which calls connectRealtime()/getSocket() from a
// real socket.io-client — without this mock every test here would attempt a real socket connection
// in jsdom (AggregateError noise, no server to connect to).
vi.mock('../api/realtime', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

const ADMIN: AuthUser = { id: 'u1', name: 'Admin', email: 'a@t.test', role: 'admin' };

function renderAt(path: string, user: AuthUser = ADMIN) {
  useAuthStore.setState({ accessToken: 't', user });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

async function pick(name: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('WidgetEditorPage', () => {
  beforeEach(() => {
    vi.spyOn(widgetsApi, 'getDimensions').mockResolvedValue([
      { key: 'month', label: 'Month' }, { key: 'airlineCode', label: 'Airline' },
    ]);
    vi.spyOn(groupsApi, 'getGroupFields').mockResolvedValue([
      { key: 'airlineCode', label: 'Airline', type: 'string', operators: ['equals', 'contains', 'in'] },
    ]);
    vi.spyOn(usersApi, 'getUserDirectory').mockResolvedValue([{ id: 'u1', name: 'Admin' }]);
  });

  it('has no source selector — every widget carries its own conditions', async () => {
    renderAt('/dashboard/widgets/new');
    expect(screen.queryByRole('combobox', { name: 'Source' })).not.toBeInTheDocument();
    // The condition builder is always present now, not gated behind a source choice.
    expect(await screen.findByRole('button', { name: 'Add condition' })).toBeInTheDocument();
  });

  it('creates a conditions-backed table widget and navigates to /dashboard', async () => {
    const create = vi.spyOn(widgetsApi, 'createWidget').mockResolvedValue({ id: 'w9' });
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({ widgets: [], layout: [] });
    const router = renderAt('/dashboard/widgets/new');

    await userEvent.type(await screen.findByLabelText('Widget name'), 'By airline');
    await userEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await pick('Metric', 'Count');
    await pick('Group by', 'Airline');
    await pick('Display', 'Table');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save widget' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: 'By airline',
        conditions: [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
        vizType: 'table',
        aggregation: { fn: 'count', field: undefined, groupBy: 'airlineCode' },
        chartType: undefined,
        period: 'all',
        sharedWith: { mode: 'private', users: [] },
      });
      expect(router.state.location.pathname).toBe('/dashboard');
    });
  });

  it('seeds the editor from a starter template in the URL', async () => {
    renderAt('/dashboard/widgets/new?template=revenue-this-month');
    // Name, period, and metric are prefilled from the template (all editable).
    expect(await screen.findByLabelText('Widget name')).toHaveValue('Revenue this month');
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('This month');
    expect(screen.getByRole('combobox', { name: 'Metric' })).toHaveTextContent('Sum of amount');
  });

  it('saves a conditions-free widget (name only, no conditions added)', async () => {
    const create = vi.spyOn(widgetsApi, 'createWidget').mockResolvedValue({ id: 'w9' });
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({ widgets: [], layout: [] });
    renderAt('/dashboard/widgets/new');

    await userEvent.type(await screen.findByLabelText('Widget name'), 'All revenue');
    await pick('Metric', 'Sum of amount');
    // No conditions added at all — Save must be enabled with just a name.
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save widget' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'All revenue', conditions: [] }))
    );
  });

  it('previews a number widget from the chosen source', async () => {
    const preview = vi.spyOn(widgetsApi, 'previewWidget').mockResolvedValue({ kind: 'scalar', value: 12 });
    renderAt('/dashboard/widgets/new');

    await userEvent.type(await screen.findByLabelText('Widget name'), 'Total');
    await userEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await pick('Metric', 'Sum of amount');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith({
        conditions: [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
        vizType: 'number',
        aggregation: { fn: 'sum', field: 'amount', groupBy: undefined },
        chartType: undefined,
        period: 'all',
      })
    );
    expect(await screen.findByText('$12.00')).toBeInTheDocument();
  });

  // THE HEADLINE BUG THIS WHOLE RENDER PASS EXISTS TO KILL — it still reproduced here even after
  // DashboardPage was fixed, because WidgetEditorPage never built or passed a keyLabel to its
  // own preview WidgetView. Verified to fail against the unfixed code (rendered the raw
  // directory id `u77` instead of the agent's name) before the `previewKeyLabel` fix was added.
  it('labels a createdBy-grouped widget in the PREVIEW with the agent name, not the raw id', async () => {
    vi.spyOn(widgetsApi, 'getDimensions').mockResolvedValue([
      { key: 'month', label: 'Month' },
      { key: 'airlineCode', label: 'Airline' },
      { key: 'createdBy', label: 'Entered by (agent)' },
    ]);
    vi.spyOn(usersApi, 'getUserDirectory').mockResolvedValue([
      { id: 'u1', name: 'Admin' },
      { id: 'u77', name: 'Priya Nair' },
    ]);
    vi.spyOn(widgetsApi, 'previewWidget').mockResolvedValue({
      kind: 'breakdown',
      rows: [{ key: 'u77', value: 3 }],
    });
    renderAt('/dashboard/widgets/new');

    await userEvent.type(await screen.findByLabelText('Widget name'), 'By agent');
    await userEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await pick('Metric', 'Count');
    await pick('Group by', 'Entered by (agent)');
    await pick('Display', 'Table');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
    expect(screen.queryByText('u77')).not.toBeInTheDocument();
  });

  // Fix 3: a preview payload computed under one aggregation must never be re-rendered under a
  // different one — e.g. a dollar sum re-read as if it were a count once Metric changes.
  it('clears a stale preview when the metric changes without re-previewing', async () => {
    vi.spyOn(widgetsApi, 'previewWidget').mockResolvedValue({ kind: 'scalar', value: 124500.5 });
    renderAt('/dashboard/widgets/new');

    await userEvent.type(await screen.findByLabelText('Widget name'), 'Total');
    await userEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await pick('Metric', 'Sum of amount');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('$124,500.50')).toBeInTheDocument();

    await pick('Metric', 'Count');

    expect(screen.queryByText('$124,500.50')).not.toBeInTheDocument();
    expect(screen.queryByText('124,501')).not.toBeInTheDocument();
  });

  it('loads an existing chart widget and updates it', async () => {
    vi.spyOn(widgetsApi, 'getWidget').mockResolvedValue({
      id: 'w1', name: 'Monthly', sharedWith: { mode: 'private', users: [] },
      conditions: [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
      vizType: 'chart', aggregation: { fn: 'sum', field: 'amount', groupBy: 'month' }, chartType: 'bar',
      period: 'all',
    });
    const update = vi.spyOn(widgetsApi, 'updateWidget').mockResolvedValue({ id: 'w1' });
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({ widgets: [], layout: [] });
    renderAt('/dashboard/widgets/w1');

    const nameInput = await screen.findByLabelText('Widget name');
    await waitFor(() => expect(nameInput).toHaveValue('Monthly'));
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Monthly sales');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save widget' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('w1', {
        name: 'Monthly sales',
        conditions: [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
        vizType: 'chart',
        aggregation: { fn: 'sum', field: 'amount', groupBy: 'month' },
        chartType: 'bar',
        period: 'all',
        sharedWith: { mode: 'private', users: [] },
      })
    );
  });

  it('creates a widget with the chosen period', async () => {
    const create = vi.spyOn(widgetsApi, 'createWidget').mockResolvedValue({ id: 'w9' });
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({ widgets: [], layout: [] });
    renderAt('/dashboard/widgets/new');

    await userEvent.type(await screen.findByLabelText('Widget name'), 'By airline');
    await userEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await pick('Period', 'This month');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save widget' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ period: 'thisMonth' }));
    });
  });

  it("defaults a new widget's period to All time", async () => {
    const create = vi.spyOn(widgetsApi, 'createWidget').mockResolvedValue({ id: 'w9' });
    vi.spyOn(widgetsApi, 'listWidgets').mockResolvedValue({ widgets: [], layout: [] });
    renderAt('/dashboard/widgets/new');

    await userEvent.type(await screen.findByLabelText('Widget name'), 'By airline');
    await userEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save widget' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ period: 'all' }));
    });
  });

  it('loads an existing widget’s period into the picker', async () => {
    vi.spyOn(widgetsApi, 'getWidget').mockResolvedValue({
      id: 'w1', name: 'Monthly', sharedWith: { mode: 'private', users: [] },
      conditions: [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
      vizType: 'table', aggregation: { fn: 'count' },
      period: 'last30Days',
    });
    renderAt('/dashboard/widgets/w1');

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Last 30 days')
    );
  });

  it('sends the period on preview, so the preview shows the real windowed number', async () => {
    const preview = vi.spyOn(widgetsApi, 'previewWidget').mockResolvedValue({ kind: 'scalar', value: 12 });
    renderAt('/dashboard/widgets/new');

    await userEvent.type(await screen.findByLabelText('Widget name'), 'Total');
    await userEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await pick('Period', 'This month');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith(expect.objectContaining({ period: 'thisMonth' }))
    );
  });

  // Same class of stale-preview lie already fixed for metric/groupBy/display: a preview computed
  // under one period must never be re-rendered as if it matched a newly picked one.
  it('clears a stale preview when the period changes without re-previewing', async () => {
    vi.spyOn(widgetsApi, 'previewWidget').mockResolvedValue({ kind: 'scalar', value: 124500.5 });
    renderAt('/dashboard/widgets/new');

    await userEvent.type(await screen.findByLabelText('Widget name'), 'Total');
    await userEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await pick('Metric', 'Sum of amount');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('$124,500.50')).toBeInTheDocument();

    await pick('Period', 'This month');

    expect(screen.queryByText('$124,500.50')).not.toBeInTheDocument();
  });
});
