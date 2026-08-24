import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { EditBookingDialog } from './edit-booking-dialog';
import * as bookingsApi from '@/api/bookings.api';
import * as customersApi from '@/api/customers.api';
import * as flightDataApi from '@/api/flightData.api';
import * as auditApi from '@/api/audit.api';
import { useAuthStore } from '@/stores/authStore';
import { UserPermissions } from '@/stores/authStore';

vi.mock('@/api/bookings.api');
vi.mock('@/api/customers.api');
vi.mock('@/api/flightData.api');
// audit.api's AUDIT_ACTION_LABELS/auditActionLabel are constants/pure functions the panel needs
// for real — a bare `vi.mock('@/api/audit.api')` would automock them to `undefined` and break
// the "Booking edited" label lookup. Spread the real module, mock only the fetch.
vi.mock('@/api/audit.api', async (importActual) => ({
  ...(await importActual<typeof auditApi>()),
  listAuditEntries: vi.fn(),
}));

const AGENT_PERMISSIONS: UserPermissions = {
  bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
  customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
  groups: { createShared: false },
  data: { viewReports: false },
  enquiries: { sendQuote: false, edit: false, delete: false },
};

const DETAIL: bookingsApi.BookingDetail = {
  booking: {
    id: 'b1',
    invoiceNumber: '10432',
    bookingDate: '2026-05-01',
    voided: false,
    pnr: 'ABC123',
    airlineCode: 'QR',
    depCity: 'ORD',
    arrCity: 'COK',
    depDate: '2026-05-08',
    arrDate: '2026-05-28',
  },
  passengers: [
    { id: 'p1', passengerName: 'SMITH/JOHN', amount: 300, customer: 'c1', payment: { status: 'paid', type: 'card', amount: 0 } },
    { id: 'p2', passengerName: 'SMITH/JANE', amount: 450, customer: 'c2', payment: { status: 'paid', type: 'card', amount: 0 } },
  ],
};

/** The default per-passenger payment object every submitted row now carries (this fixture's
 * passengers are both seeded Paid/Card with amount 0 and no paid-on date). */
const DEFAULT_PAYMENT = { status: 'paid' as const, type: 'card' as const, amount: 0 };

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EditBookingDialog bookingId="b1" onOpenChange={() => {}} queryKeyPrefix="bookings" />
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(customersApi.searchCustomers).mockResolvedValue([]);
  vi.mocked(customersApi.createCustomer).mockResolvedValue({ id: 'c_temp' });
  vi.mocked(flightDataApi.searchAirports).mockResolvedValue([]);
  vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([]);
  vi.mocked(bookingsApi.getBooking).mockResolvedValue(DETAIL);
  vi.mocked(bookingsApi.updateBooking).mockResolvedValue(DETAIL);
});

// This file never used to touch the auth store; the two audit-history tests below are the
// first to. Reset it after every test so a seeded user can't leak into whichever test runs
// next in this file — this codebase has been bitten by exactly that leakage before (see
// BookingsPage.test.tsx's notes in CLAUDE.md).
afterEach(() => {
  cleanup();
  useAuthStore.setState({ accessToken: null, user: null });
});

describe('EditBookingDialog', () => {
  it('prefills the header and every passenger on the invoice', async () => {
    renderDialog();

    expect(await screen.findByDisplayValue('10432')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ABC123')).toBeInTheDocument();
    expect(screen.getByDisplayValue('SMITH/JOHN')).toBeInTheDocument();
    expect(screen.getByDisplayValue('SMITH/JANE')).toBeInTheDocument();
    expect(screen.getByDisplayValue('450')).toBeInTheDocument();
  });

  it('sends stored passengers with their ids and a newly added one without', async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByDisplayValue('10432');
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([
      { id: 'c3', firstName: 'Bob', lastName: 'Smith', phone: '5', dob: '03-Mar-1980' },
    ]);
    await user.type(screen.getByLabelText('Passenger name 3'), 'Bob');
    await user.click(await screen.findByText('Smith/Bob'));
    await user.type(screen.getByLabelText('Amount 3'), '200');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateBooking).toHaveBeenCalled());
    const [id, input] = vi.mocked(bookingsApi.updateBooking).mock.calls[0];
    expect(id).toBe('b1');
    expect(input.passengers).toEqual([
      { id: 'p1', passengerName: 'SMITH/JOHN', amount: 300, customer: 'c1', payment: DEFAULT_PAYMENT },
      { id: 'p2', passengerName: 'SMITH/JANE', amount: 450, customer: 'c2', payment: DEFAULT_PAYMENT },
      { passengerName: 'Smith/Bob', amount: 200, customer: 'c3', payment: DEFAULT_PAYMENT },
    ]);
  });

  it('omits a removed passenger from the payload (the backend deletes it)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByDisplayValue('10432');
    await user.click(screen.getByRole('button', { name: 'Remove passenger 2' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateBooking).toHaveBeenCalled());
    const [, input] = vi.mocked(bookingsApi.updateBooking).mock.calls[0];
    expect(input.passengers).toEqual([
      { id: 'p1', passengerName: 'SMITH/JOHN', amount: 300, customer: 'c1', payment: DEFAULT_PAYMENT },
    ]);
  });

  // Regression guard for the refetch-mid-edit bug already fixed once in this codebase (see
  // send-quote-dialog.tsx's `wasOpen` ref). BookingForm avoids it differently (no reset effect at
  // all — both callers remount by key instead), but the guarantee that matters is the same: a
  // background refetch handing the open form a NEW `initial`/query object identity must not wipe
  // whatever the user has typed.
  it('keeps typed input across a background refetch mid-edit', async () => {
    const user = userEvent.setup();
    const client = renderDialog();

    await screen.findByDisplayValue('10432');
    await user.type(screen.getByLabelText('Remark'), 'follow up needed');
    expect(screen.getByLabelText('Remark')).toHaveValue('follow up needed');

    // A background refetch returning CHANGED data, which is what forces a new object identity
    // through TanStack Query's structuralSharing (on by default). Without a real change it returns
    // the previous reference, `initial` never changes identity, and this guard would be hollow.
    //
    // It changes the very fields the test asserts on, and the assertion waits for the DialogTitle
    // (rendered outside BookingForm, straight from query data) to show the new invoice number.
    // `waitFor(getBooking called twice)` would only prove the mock ran — that resolves before React
    // commits the data, so asserting immediately after races ahead of the re-render and a reset bug
    // could wipe the form a tick later unseen.
    vi.mocked(bookingsApi.getBooking).mockResolvedValue({
      ...DETAIL,
      booking: { ...DETAIL.booking, invoiceNumber: '99999' },
      passengers: [
        { ...DETAIL.passengers[0], remark: 'changed server-side' },
        DETAIL.passengers[1],
      ],
    });
    await client.refetchQueries({ queryKey: ['bookings', 'detail', 'b1'] });
    await screen.findByText(/99999/);

    // The form must NOT have been re-seeded from the refetched data: passenger 1's Remark field
    // keeps what the user typed (not the server's 'changed server-side'), and — the strongest check
    // — the Invoice number input inside the form still shows the ORIGINAL '10432', proving the
    // form's own state is independent of the query data even though the title (outside the form)
    // moved on.
    expect(screen.getByLabelText('Remark')).toHaveValue('follow up needed');
    expect(screen.getByLabelText('Invoice number')).toHaveValue('10432');
  });

  // Regression guard: the `voided` branch used to always substitute a single
  // id-less `{ passengerName: 'VOID', amount: 0 }` row, which — because PATCH /bookings/:id
  // treats `passengers[]` as the complete desired end state — deleted every real stored
  // passenger on the invoice the moment an existing booking was marked voided and saved.
  it('sends the stored passengers with their ids (not an id-less VOID row) when voiding an existing booking', async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByDisplayValue('10432');
    await user.click(screen.getByRole('checkbox', { name: 'Mark as voided' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateBooking).toHaveBeenCalled());
    const [, input] = vi.mocked(bookingsApi.updateBooking).mock.calls[0];
    expect(input.voided).toBe(true);
    expect(input.passengers).toEqual([
      { id: 'p1', passengerName: 'SMITH/JOHN', amount: 300, customer: 'c1', payment: DEFAULT_PAYMENT },
      { id: 'p2', passengerName: 'SMITH/JANE', amount: 450, customer: 'c2', payment: DEFAULT_PAYMENT },
    ]);
  });

  it('sends the selected customer id when picking an autocomplete match for an unlinked passenger', async () => {
    const user = userEvent.setup();
    vi.mocked(bookingsApi.getBooking).mockResolvedValue({
      ...DETAIL,
      passengers: [
        { id: 'p1', passengerName: 'SMITH/JOHN', amount: 300, customer: 'c1' },
        { id: 'p2', passengerName: 'SMITH/JANE', amount: 450 },
      ],
    });
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([
      { id: 'c2', firstName: 'Jane', lastName: 'Doe', phone: '555-0100', dob: '02-Sep-1953' },
    ]);
    renderDialog();

    await screen.findByDisplayValue('10432');
    await user.click(screen.getByRole('button', { name: 'Select customer for passenger 2' }));
    await user.type(screen.getByLabelText('Passenger name 2'), 'Doe');
    await user.click(await screen.findByText('Doe/Jane'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateBooking).toHaveBeenCalled());
    const [, input] = vi.mocked(bookingsApi.updateBooking).mock.calls[0];
    expect(input.passengers[1]).toEqual({
      id: 'p2', passengerName: 'Doe/Jane', amount: 450, customer: 'c2', payment: DEFAULT_PAYMENT,
    });
  });

  it('a linked passenger name is read-only; changing it requires re-picking a customer', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByDisplayValue('10432');
    const nameField = screen.getByLabelText('Passenger name');
    expect(nameField).toHaveAttribute('readonly');

    vi.mocked(customersApi.searchCustomers).mockResolvedValue([
      { id: 'c9', firstName: 'New', lastName: 'Person', phone: '5', dob: '01-Jan-1990' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Change customer for passenger 1' }));
    await user.type(screen.getByLabelText('Passenger name'), 'New');
    await user.click(await screen.findByText('Person/New'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateBooking).toHaveBeenCalled());
    const [, input] = vi.mocked(bookingsApi.updateBooking).mock.calls[0];
    expect(input.passengers[0]).toEqual({
      id: 'p1', passengerName: 'Person/New', amount: 300, customer: 'c9', payment: DEFAULT_PAYMENT,
    });
  });

  it('renders 0 (not empty) in the Amount owed input for a pending payment stored with amount 0', async () => {
    vi.mocked(bookingsApi.getBooking).mockResolvedValue({
      ...DETAIL,
      passengers: [
        { ...DETAIL.passengers[0], payment: { status: 'pending', type: 'card', amount: 0 } },
        DETAIL.passengers[1],
      ],
    });
    renderDialog();

    await screen.findByDisplayValue('10432');
    expect(screen.getByLabelText('Amount owed')).toHaveValue(0);
  });

  // FIX 1: neither this form nor `edit-adjustment-dialog.tsx` sends `payment.paidOn` — only
  // `record-payment-dialog.tsx` lets staff set it. But `PATCH /bookings/:id` replaces each
  // submitted passenger's `payment` as a whole object, so saving ANY unrelated field (a remark
  // typo, say) after a payment was recorded with a paid-on date silently erases that date forever,
  // with no indication.
  it('preserves an existing payment.paidOn when saving an unrelated field', async () => {
    const user = userEvent.setup();
    vi.mocked(bookingsApi.getBooking).mockResolvedValue({
      ...DETAIL,
      passengers: [
        { ...DETAIL.passengers[0], payment: { status: 'pending', type: 'card', amount: 150, paidOn: '2026-07-01' } },
        DETAIL.passengers[1],
      ],
    });
    renderDialog();

    await screen.findByDisplayValue('10432');
    await user.type(screen.getByLabelText('Remark'), 'typo fix');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateBooking).toHaveBeenCalled());
    const [, input] = vi.mocked(bookingsApi.updateBooking).mock.calls[0];
    expect(input.passengers[0].payment?.paidOn).toBe('2026-07-01');
  });

  // FIX 5: adding a blank passenger row and THEN ticking "Mark as voided" hides the Passengers
  // section — the blank row's `required` attribute can no longer fire — but the row was still
  // sitting in this component's state, so without a filter it is submitted as
  // `passengerName: ''`, which the backend 400s.
  it('drops a blank added passenger row from the payload when voided is ticked afterward', async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByDisplayValue('10432');
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.click(screen.getByRole('checkbox', { name: 'Mark as voided' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateBooking).toHaveBeenCalled());
    const [, input] = vi.mocked(bookingsApi.updateBooking).mock.calls[0];
    expect(input.passengers).toEqual([
      { id: 'p1', passengerName: 'SMITH/JOHN', amount: 300, customer: 'c1', payment: DEFAULT_PAYMENT },
      { id: 'p2', passengerName: 'SMITH/JANE', amount: 450, customer: 'c2', payment: DEFAULT_PAYMENT },
    ]);
  });

  // FIX 4: this dialog used to render "Save failed. Check your connection and try again." for
  // EVERY backend failure, even a semantic one the user can actually fix. The user would be told
  // to check their connection and retry forever instead of being told the real problem.
  // (Re-fixtured 2026-07-13 on HAS_ADJUSTMENTS: the backend deleted INVOICE_NUMBER_IN_USE the same
  // day `invoiceNumber` stopped being unique — a repeated invoice number is now a dismissible 409
  // DUPLICATE_BOOKING_WARNING with its own dedicated UI panel, not a generic error line. This test
  // genuinely exercises errorMessage()'s generic extraction for any OTHER 409, so it is re-pointed
  // at a code the API can still actually return rather than deleted.)
  it('surfaces the backend HAS_ADJUSTMENTS message instead of a generic connection error', async () => {
    const user = userEvent.setup();
    vi.mocked(bookingsApi.updateBooking).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: { error: { code: 'HAS_ADJUSTMENTS', message: 'Cannot delete: 1 reissue recorded against this booking — delete those first.' } },
      },
    } as unknown as AxiosError);
    renderDialog();

    await screen.findByDisplayValue('10432');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('Cannot delete: 1 reissue recorded against this booking — delete those first.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument();
  });

  it('shows the invoice history to a superadmin', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'u1', name: 'Root', email: 'r@example.com', role: 'superadmin' },
    });
    vi.mocked(auditApi.listAuditEntries).mockResolvedValue({
      entries: [
        {
          id: 'a1',
          actor: { id: 'u1', name: 'Priya Nair', email: 'p@example.com' },
          action: 'booking.update',
          targetCollection: 'bookings',
          targetId: 'b1',
          summary: { changes: [{ path: 'pnr', from: 'ABC123', to: 'XYZ789' }] },
          createdAt: '2026-07-18T10:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderDialog();
    // The panel is mounted with title="Invoice history" (per the brief — an invoice's history
    // spans the Booking header AND its passengers), so the rendered heading is "Invoice
    // history", not the panel's bare default "History".
    expect(await screen.findByText('Invoice history')).toBeInTheDocument();
    expect(await screen.findByText('Booking edited')).toBeInTheDocument();
    // Uses bookingRef, NOT targetId — an invoice's history spans the header AND its
    // passengers, including a deleted passenger the frontend no longer has an id for.
    expect(auditApi.listAuditEntries).toHaveBeenCalledWith(
      expect.objectContaining({ bookingRef: 'b1' })
    );
  });

  it('hides the history from an agent', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'u2', name: 'Agent', email: 'a@example.com', role: 'agent', permissions: AGENT_PERMISSIONS },
    });
    renderDialog();
    await screen.findByLabelText(/invoice number/i);
    expect(screen.queryByText('Invoice history')).not.toBeInTheDocument();
  });
});
