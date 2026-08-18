import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { vi } from 'vitest';
import { createAppRouter } from '../router';
import { useAuthStore, AuthUser } from '../stores/authStore';
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

const FIELDS: groupsApi.GroupFieldMeta[] = [
  { key: 'airlineCode', label: 'Airline', type: 'string', operators: ['equals', 'contains', 'in'] },
];

const ADMIN: AuthUser = { id: 'u1', name: 'Admin', email: 'a@t.test', role: 'admin' };
const AGENT_NO_SHARE: AuthUser = {
  id: 'u2', name: 'Agent', email: 'g@t.test', role: 'agent',
  permissions: {
    bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: true, import: false, export: false, sendInvoice: false },
    customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
    groups: { createShared: false },
    data: { viewReports: false },
    enquiries: { sendQuote: false, edit: false, delete: false },
  },
};

function renderAt(path: string, user: AuthUser) {
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

describe('GroupEditorPage', () => {
  beforeEach(() => {
    vi.spyOn(groupsApi, 'getGroupFields').mockResolvedValue(FIELDS);
    vi.spyOn(usersApi, 'getUserDirectory').mockResolvedValue([
      { id: 'u1', name: 'Admin' },
      { id: 'u2', name: 'Agent' },
    ]);
  });

  it('builds a condition, previews it, and shows results', async () => {
    const preview = vi.spyOn(groupsApi, 'previewGroup').mockResolvedValue({
      rows: [
        {
          id: 'p1',
          date: '2026-05-04T00:00:00.000Z',
          invoiceNumber: '0000150',
          passengerName: 'JOSEPH/SHINY S',
          bookingType: 'New',
          pnr: 'GUDBFX',
          airlineCode: 'QR',
          depCity: 'DXB',
          arrCity: 'COK',
          depDate: '2026-05-08T00:00:00.000Z',
          arrDate: '2026-05-28T00:00:00.000Z',
          amount: 2400.02,
          paymentStatus: 'paid',
        },
      ],
      total: 1, page: 1, pageSize: 25,
    });
    renderAt('/groups/new', ADMIN);

    await screen.findByRole('button', { name: 'Add condition' });
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith(
        [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
        { page: 1, pageSize: 25, sortBy: undefined, sortDir: undefined }
      )
    );
    expect(await screen.findByText('JOSEPH/SHINY S')).toBeInTheDocument();
    expect(screen.getByText(/1 result/)).toBeInTheDocument();
  });

  it('re-runs the preview with the new sort when a column header is clicked', async () => {
    const preview = vi.spyOn(groupsApi, 'previewGroup').mockResolvedValue({
      rows: [
        {
          id: 'p1', date: '2026-05-04T00:00:00.000Z', invoiceNumber: '0000150',
          passengerName: 'JOSEPH/SHINY S', bookingType: 'New', pnr: 'GUDBFX', airlineCode: 'QR',
          amount: 2400.02, paymentStatus: 'paid',
        },
      ],
      total: 1, page: 1, pageSize: 25,
    });
    renderAt('/groups/new', ADMIN);

    await screen.findByRole('button', { name: 'Add condition' });
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('JOSEPH/SHINY S')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Name of PAX/ }));

    await waitFor(() =>
      expect(preview).toHaveBeenLastCalledWith(
        [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
        { page: 1, pageSize: 25, sortBy: 'passengerName', sortDir: 'asc' }
      )
    );
  });

  it('saves a new shared group (admin sees share controls) and navigates to /groups', async () => {
    const create = vi.spyOn(groupsApi, 'createGroup').mockResolvedValue({ id: 'g9' });
    vi.spyOn(groupsApi, 'listGroups').mockResolvedValue([]);
    const router = renderAt('/groups/new', ADMIN);

    await screen.findByRole('button', { name: 'Add condition' });
    await userEvent.type(screen.getByLabelText('Group name'), 'QR only');
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await pick('Share mode', 'Shared');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Share with Agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save group' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: 'QR only',
        conditions: [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
        sharedWith: { mode: 'shared', users: ['u2'] },
      });
      expect(router.state.location.pathname).toBe('/groups');
    });
  });

  it('hides share controls from an agent without groups.createShared and saves private', async () => {
    const create = vi.spyOn(groupsApi, 'createGroup').mockResolvedValue({ id: 'g9' });
    vi.spyOn(groupsApi, 'listGroups').mockResolvedValue([]);
    renderAt('/groups/new', AGENT_NO_SHARE);

    await screen.findByRole('button', { name: 'Add condition' });
    await userEvent.type(screen.getByLabelText('Group name'), 'Mine');
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'EK');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('combobox', { name: 'Share mode' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save group' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: 'Mine',
        conditions: [{ field: 'airlineCode', operator: 'equals', value: 'EK' }],
        sharedWith: { mode: 'private', users: [] },
      });
    });
  });

  it('loads an existing group and updates it via PATCH', async () => {
    vi.spyOn(groupsApi, 'getGroup').mockResolvedValue({
      id: 'g1', name: 'Old name', owner: { id: 'u1', name: 'Admin' }, sharedWith: { mode: 'private', users: [] },
      conditions: [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
      excludedCount: 0,
    });
    const update = vi.spyOn(groupsApi, 'updateGroup').mockResolvedValue({ id: 'g1' });
    vi.spyOn(groupsApi, 'listGroups').mockResolvedValue([]);
    renderAt('/groups/g1/edit', ADMIN);

    const nameInput = await screen.findByLabelText('Group name');
    await waitFor(() => expect(nameInput).toHaveValue('Old name'));
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New name');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save group' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('g1', {
        name: 'New name',
        conditions: [{ field: 'airlineCode', operator: 'equals', value: 'QR' }],
        sharedWith: { mode: 'private', users: [] },
      });
    });
  });

  it('shows a working View menu on the live preview', async () => {
    vi.spyOn(groupsApi, 'previewGroup').mockResolvedValue({
      rows: [
        {
          id: 'p1', date: '2026-05-04T00:00:00.000Z', invoiceNumber: '0000150',
          passengerName: 'JOSEPH/SHINY S', bookingType: 'New', pnr: 'GUDBFX', airlineCode: 'QR',
          amount: 2400.02, paymentStatus: 'paid', remark: 'Aisle seat',
        },
      ],
      total: 1, page: 1, pageSize: 25,
    });
    renderAt('/groups/new', ADMIN);

    await screen.findByRole('button', { name: 'Add condition' });
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'QR');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('Aisle seat')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Remark' }));

    await waitFor(() => expect(screen.queryByText('Aisle seat')).not.toBeInTheDocument());
  });
});
