import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FUTURE_ARR_DATE, FUTURE_DEP_DATE } from '@/test-utils/dates';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingForm } from './booking-form';
import { createBooking, updateBooking, type BookingDetail } from '@/api/bookings.api';
import { searchCustomers } from '@/api/customers.api';

vi.mock('@/api/bookings.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bookings.api')>()),
  createBooking: vi.fn(),
  updateBooking: vi.fn(),
}));
vi.mock('@/api/flightData.api', () => ({
  searchAirports: vi.fn().mockResolvedValue([]),
  searchAirlines: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/api/customers.api', () => ({ searchCustomers: vi.fn().mockResolvedValue([]) }));

function renderForm(initial?: BookingDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BookingForm initial={initial} onDone={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>
  );
}

const EXISTING_BOOKING: BookingDetail = {
  booking: {
    id: 'b1',
    invoiceNumber: '000005',
    bookingDate: '2025-11-12',
    voided: false,
    pnr: 'GUDBFX',
    airlineCode: 'QR',
    depCity: 'ORD',
    arrCity: 'COK',
    depDate: FUTURE_DEP_DATE,
    arrDate: FUTURE_ARR_DATE,
  },
  passengers: [
    { id: 'p1', passengerName: 'John Smith', amount: 500, customer: 'c1', payment: { status: 'paid', type: 'card', amount: 0 } },
  ],
};

const TODAY = new Date().toISOString().slice(0, 10);

/** DateField's control is a visually-hidden native `<input type="date">` carrying the accessible
 * name; userEvent can't type into it, so set it the way a date picker would. */
function pickDate(label: string, iso: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: iso } });
}

const MATCH = { id: 'c1', firstName: 'Jane', lastName: 'Smith', phone: '555-0100', dob: '02-Sep-1953' };

async function linkFirstPassenger(user: ReturnType<typeof userEvent.setup>) {
  vi.mocked(searchCustomers).mockResolvedValue([MATCH]);
  await user.type(screen.getByLabelText(/Passenger name/i), 'Jane');
  await user.click(await screen.findByText('Smith/Jane')); // dropdown now lists ticketing name
}

describe('BookingForm booking date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to today', () => {
    renderForm();
    expect(screen.getByLabelText('Booking Date')).toHaveValue(TODAY);
  });

  // The regression this field exists for: the form used to hold bookingDate in state with NO input
  // rendered, so every booking created in the UI was silently dated today and a historical invoice
  // could not be back-dated at all (import was the only way in).
  it('submits the date the user picked, not today', async () => {
    const user = userEvent.setup();
    vi.mocked(createBooking).mockResolvedValue({ id: 'b9', invoiceNumber: '000005', passengers: [] });
    renderForm();

    await user.type(screen.getByLabelText('Invoice#'), '000005');
    pickDate('Booking Date', '2025-11-12');
    await user.type(screen.getByLabelText(/PNR/i), 'GUDBFX');
    await user.type(screen.getByLabelText(/Airline/i), 'QR');
    await user.type(screen.getByLabelText('Departure city'), 'ORD');
    await user.type(screen.getByLabelText('Arrival city'), 'COK');
    pickDate('Departure Date', FUTURE_DEP_DATE);
    pickDate('Arrival Date', FUTURE_ARR_DATE);
    await linkFirstPassenger(user);
    await user.type(screen.getByLabelText(/^Amount$/i), '700');
    await user.click(screen.getByRole('button', { name: /create booking/i }));

    await waitFor(() => expect(createBooking).toHaveBeenCalledTimes(1));
    const input = vi.mocked(createBooking).mock.calls[0][0];
    expect(input.bookingDate).toBe('2025-11-12');
    expect(input.bookingDate).not.toBe(TODAY);
  });

  it('EDIT: prefills the stored date and can change it', async () => {
    const user = userEvent.setup();
    vi.mocked(updateBooking).mockResolvedValue(EXISTING_BOOKING);
    renderForm(EXISTING_BOOKING);

    expect(screen.getByLabelText('Booking Date')).toHaveValue('2025-11-12');

    pickDate('Booking Date', '2026-01-03');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateBooking).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateBooking).mock.calls[0][1].bookingDate).toBe('2026-01-03');
  });

  // A voided invoice is recorded with nothing but an invoice number, a booking date and a remark —
  // so the date must stay reachable when the voided checkbox hides the rest of the form.
  it('stays visible and editable when the invoice is marked voided', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText(/Mark as voided/i));

    expect(screen.getByLabelText('Booking Date')).toBeInTheDocument();
    pickDate('Booking Date', '2025-11-12');
    expect(screen.getByLabelText('Booking Date')).toHaveValue('2025-11-12');
  });

  it('does not submit a New booking when Departure city is empty', async () => {
    const user = userEvent.setup();
    vi.mocked(createBooking).mockResolvedValue({ id: 'bX', invoiceNumber: '000005', passengers: [] });
    renderForm();

    await user.type(screen.getByLabelText('Invoice#'), '000005');
    pickDate('Booking Date', '2025-11-12');
    await user.type(screen.getByLabelText(/PNR/i), 'GUDBFX');
    await user.type(screen.getByLabelText(/Airline/i), 'QR');
    // Deliberately leave Departure city empty; every other required field is filled (including
    // the customer link) so Departure city is the SOLE blocker for this assertion.
    await user.type(screen.getByLabelText('Arrival city'), 'COK');
    pickDate('Departure Date', FUTURE_DEP_DATE);
    pickDate('Arrival Date', FUTURE_ARR_DATE);
    await linkFirstPassenger(user);
    await user.type(screen.getByLabelText(/^Amount$/i), '700');
    await user.click(screen.getByRole('button', { name: /create booking/i }));

    // Native `required` on the Departure city field blocks submission.
    await new Promise((r) => setTimeout(r, 50));
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('does not submit when a passenger row has no selected customer', async () => {
    const user = userEvent.setup();
    vi.mocked(createBooking).mockResolvedValue({ id: 'bY', invoiceNumber: '000005', passengers: [] });
    renderForm();

    await user.type(screen.getByLabelText('Invoice#'), '000005');
    pickDate('Booking Date', '2025-11-12');
    await user.type(screen.getByLabelText(/PNR/i), 'GUDBFX');
    await user.type(screen.getByLabelText(/Airline/i), 'QR');
    await user.type(screen.getByLabelText('Departure city'), 'ORD');
    await user.type(screen.getByLabelText('Arrival city'), 'COK');
    pickDate('Departure Date', FUTURE_DEP_DATE);
    pickDate('Arrival Date', FUTURE_ARR_DATE);
    await user.type(screen.getByLabelText(/^Amount$/i), '700'); // no customer picked
    await user.click(screen.getByRole('button', { name: /create booking/i }));

    expect(await screen.findByText(/select a customer/i)).toBeInTheDocument();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('lists customers as LastName/GivenName with a DOB subtext', async () => {
    const user = userEvent.setup();
    vi.mocked(searchCustomers).mockResolvedValue([
      { id: 'c1', firstName: 'Jane', middleName: 'Ann', lastName: 'Smith', phone: '5', dob: '02-Sep-1953' },
    ]);
    renderForm();
    await user.type(screen.getByLabelText('Passenger name'), 'Jane');
    expect(await screen.findByText('Smith/Jane Ann')).toBeInTheDocument();
    expect(screen.getByText('02-Sep-1953')).toBeInTheDocument();
  });

  it('a linked passenger name is read-only and changeable only via Change customer', async () => {
    const user = userEvent.setup();
    renderForm();
    await linkFirstPassenger(user);
    const field = screen.getByLabelText('Passenger name');
    expect(field).toHaveValue('Smith/Jane');
    expect(field).toHaveAttribute('readonly');
    // Re-pick a different customer via the clear control.
    vi.mocked(searchCustomers).mockResolvedValue([
      { id: 'c2', firstName: 'John', lastName: 'Doe', phone: '5', dob: '01-Jan-1990' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Change customer for passenger 1' }));
    await user.type(screen.getByLabelText('Passenger name'), 'John');
    await user.click(await screen.findByText('Doe/John'));
    expect(screen.getByLabelText('Passenger name')).toHaveValue('Doe/John');
  });

  it('submits with the linked customer id once a match is picked', async () => {
    const user = userEvent.setup();
    vi.mocked(createBooking).mockResolvedValue({ id: 'bZ', invoiceNumber: '000005', passengers: [] });
    renderForm();

    await user.type(screen.getByLabelText('Invoice#'), '000005');
    pickDate('Booking Date', '2025-11-12');
    await user.type(screen.getByLabelText(/PNR/i), 'GUDBFX');
    await user.type(screen.getByLabelText(/Airline/i), 'QR');
    await user.type(screen.getByLabelText('Departure city'), 'ORD');
    await user.type(screen.getByLabelText('Arrival city'), 'COK');
    pickDate('Departure Date', FUTURE_DEP_DATE);
    pickDate('Arrival Date', FUTURE_ARR_DATE);
    await linkFirstPassenger(user);
    await user.type(screen.getByLabelText(/^Amount$/i), '700');
    await user.click(screen.getByRole('button', { name: /create booking/i }));

    await waitFor(() => expect(createBooking).toHaveBeenCalledTimes(1));
    const input = vi.mocked(createBooking).mock.calls[0][0];
    // Linking a customer stores the ticketing name (LastName/GivenName), not the dropdown label.
    // Every submitted passenger carries its own (here, default) payment object.
    expect(input.passengers).toEqual([
      { passengerName: 'Smith/Jane', amount: 700, customer: 'c1', payment: { status: 'paid', type: 'card', amount: 0 } },
    ]);
  });

  it('clears the pending "select a customer" alert when a new passenger row is added', async () => {
    const user = userEvent.setup();
    renderForm();
    // Fill every native-required field but link no customer, then submit → the gate blocks and the alert shows.
    await user.type(screen.getByLabelText('Invoice#'), '000005');
    pickDate('Booking Date', '2025-11-12');
    await user.type(screen.getByLabelText(/PNR/i), 'GUDBFX');
    await user.type(screen.getByLabelText(/Airline/i), 'QR');
    await user.type(screen.getByLabelText('Departure city'), 'ORD');
    await user.type(screen.getByLabelText('Arrival city'), 'COK');
    pickDate('Departure Date', FUTURE_DEP_DATE);
    pickDate('Arrival Date', FUTURE_ARR_DATE);
    await user.type(screen.getByLabelText(/^Amount$/i), '700');
    await user.click(screen.getByRole('button', { name: /create booking/i }));
    expect(await screen.findByText(/select a customer/i)).toBeInTheDocument();

    // Adding a fresh row must not carry the red alert over to it (or any row) until the next submit.
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    expect(screen.queryByText(/select a customer/i)).not.toBeInTheDocument();
  });

  it('shows the originally recorded name while re-searching a historic unlinked passenger', async () => {
    const user = userEvent.setup();
    const historic: BookingDetail = {
      ...EXISTING_BOOKING,
      passengers: [{ id: 'p1', passengerName: 'SMITH/JANE', amount: 500 }], // no customer = historic unlinked
    };
    renderForm(historic);

    // Grandfathered: informational, not a blocking error (see booking-form.link.test.tsx).
    expect(screen.getByText('Not linked (historic entry)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select customer for passenger 1' }));
    // The stored name stays visible as guidance while the user searches for the matching customer.
    expect(screen.getByText('Originally recorded as SMITH/JANE')).toBeInTheDocument();
  });

  describe('trip dates', () => {
    it('does NOT floor Departure/Arrival Date at today on create — old invoices can be entered', () => {
      renderForm();
      // A past trip date is legitimate: staff routinely enter invoices after the flight has flown.
      expect(screen.getByLabelText('Departure Date')).not.toHaveAttribute('min');
      // Arrival has no floor until a Departure Date is chosen.
      expect(screen.getByLabelText('Arrival Date')).not.toHaveAttribute('min');
    });

    it('still keeps Arrival Date on or after the chosen Departure Date', () => {
      renderForm();
      pickDate('Departure Date', FUTURE_DEP_DATE);
      // Arrival can't precede its own departure, so the later of the two bounds wins.
      expect(screen.getByLabelText('Arrival Date')).toHaveAttribute('min', FUTURE_DEP_DATE);
    });

    it('leaves Booking Date unbounded on create — back-dating the ledger entry is legitimate', () => {
      renderForm();
      expect(screen.getByLabelText('Booking Date')).not.toHaveAttribute('min');
    });

    it('does NOT floor the dates when EDITING, so a historic invoice stays editable', () => {
      // A bulk-imported invoice has trip dates years in the past. Flooring them here would make it
      // impossible to fix an unrelated field (a typo'd PNR, say) without also inventing new dates.
      renderForm({
        ...EXISTING_BOOKING,
        booking: { ...EXISTING_BOOKING.booking, depDate: '2024-03-01', arrDate: '2024-03-20' },
      });
      expect(screen.getByLabelText('Departure Date')).not.toHaveAttribute('min');
      expect(screen.getByLabelText('Arrival Date')).not.toHaveAttribute('min');
    });
  });
});
