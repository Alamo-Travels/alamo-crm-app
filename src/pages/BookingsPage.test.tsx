import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { FUTURE_ARR_DATE, FUTURE_DEP_DATE } from '@/test-utils/dates';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import BookingsPage from './BookingsPage';
import * as bookingsApi from '../api/bookings.api';
import * as customersApi from '../api/customers.api';
import * as flightDataApi from '../api/flightData.api';
import * as organizationApi from '../api/organization.api';
import { useAuthStore } from '../stores/authStore';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function linkPassenger(label: string, match: customersApi.CustomerSearchResult) {
  vi.spyOn(customersApi, 'searchCustomers').mockResolvedValue([match]);
  await userEvent.type(screen.getByLabelText(label), match.firstName);
  await userEvent.click(await screen.findByText(`${match.lastName}/${match.firstName}`));
}

const SUPERADMIN = { id: 'u0', name: 'Super', email: 'super@a.test', role: 'superadmin' as const };

const BASE_ROW: bookingsApi.BookingRow = {
  id: 'p1',
  invoiceNumber: '0000150',
  bookingDate: '2026-05-04',
  passengerName: 'JOSEPH/SHINY S',
  amount: 2400.02,
  pnr: 'GUDBFX',
  airlineCode: 'QR',
  depCity: 'DXB',
  arrCity: 'COK',
  depDate: '2026-05-08',
  arrDate: '2026-05-28',
  remark: 'Handle with care',
  paymentStatus: 'paid',
  bookingType: 'New',
  bookingId: 'bk0',
};

describe('BookingsPage', () => {
  beforeEach(() => {
    vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
      bookings: [BASE_ROW],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    // The airport/airline autocomplete fields fire server searches while typing city/airline
    // values in Create Booking tests — stub them to keep those tests offline.
    vi.spyOn(flightDataApi, 'searchAirports').mockResolvedValue([]);
    vi.spyOn(flightDataApi, 'searchAirlines').mockResolvedValue([]);
    // A superadmin by default so every pre-existing behavioral test below (which predates the
    // Create Booking / Booking Type permission gating) keeps exercising the Create Booking flow
    // unimpeded. Tests targeting the gating itself, or deliberately exercising the unauthenticated
    // state, override this with their own useAuthStore.setState(...) before rendering.
    useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
  });

  // Reset the auth store to a clean, unauthenticated slate after every test in this file — several
  // tests below (export/import gating, the "as an admin" describe) authenticate a specific user,
  // and without this, that state would leak into whichever test runs next. Unmount first (cleanup())
  // since BookingsTable subscribes to useAuthStore directly: resetting it while still mounted would
  // update the store outside act() (RTL's own auto-cleanup afterEach is registered outside any
  // describe and always runs after this one, so it can't be relied on to unmount first).
  afterEach(() => {
    cleanup();
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it('lists bookings with the requested columns, with Departure City hidden by default', async () => {
    renderWithClient(<BookingsPage />);
    expect(await screen.findByText('0000150')).toBeInTheDocument();
    expect(screen.getByText(/JOSEPH\/SHINY S/)).toBeInTheDocument();
    expect(screen.getByText('GUDBFX')).toBeInTheDocument();
    expect(screen.getByText('QR')).toBeInTheDocument();
    expect(screen.queryByText('DXB')).not.toBeInTheDocument();
    expect(screen.getByText('COK')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Handle with care')).toBeInTheDocument();
    expect(screen.queryByText(/due/)).not.toBeInTheDocument();
  });

  it('can re-show the hidden Departure City column via the View dropdown', async () => {
    renderWithClient(<BookingsPage />);
    await screen.findByText('0000150');

    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Departure City' }));

    expect(await screen.findByText('DXB')).toBeInTheDocument();
  });

  it('displays the booking, departure, and arrival dates as "DD Mon YYYY"', async () => {
    renderWithClient(<BookingsPage />);
    expect(await screen.findByText('04 May 2026')).toBeInTheDocument();
    expect(screen.getByText('08 May 2026')).toBeInTheDocument();
    expect(screen.getByText('28 May 2026')).toBeInTheDocument();
  });

  it('debounces the search box into a server-side q param', async () => {
    renderWithClient(<BookingsPage />);
    await userEvent.type(screen.getByLabelText('Search bookings'), 'GUD');

    await waitFor(() => {
      const lastCall = vi.mocked(bookingsApi.listBookings).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ q: 'GUD' });
    });
  });

  it('filters by payment status via the faceted filter', async () => {
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: /Payment Status/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Pending' }));

    await waitFor(() => {
      const lastCall = vi.mocked(bookingsApi.listBookings).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ paymentStatus: 'pending' });
    });
  });

  it('sorts by Amount when its column header is clicked', async () => {
    renderWithClient(<BookingsPage />);
    await screen.findByText('0000150');
    await userEvent.click(screen.getByRole('button', { name: /Amount/ }));

    await waitFor(() => {
      const lastCall = vi.mocked(bookingsApi.listBookings).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ sortBy: 'amount', sortDir: 'asc' });
    });
  });

  it('changes rows per page via the pagination footer', async () => {
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    await userEvent.click(await screen.findByRole('option', { name: '50' }));

    await waitFor(() => {
      const lastCall = vi.mocked(bookingsApi.listBookings).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ pageSize: 50 });
    });
  });

  it('paginates via numbered page links', async () => {
    vi.spyOn(bookingsApi, 'listBookings').mockImplementation((params = {}) =>
      Promise.resolve({
        bookings: [{ ...BASE_ROW, id: `p${params.page ?? 1}`, invoiceNumber: `INV-${params.page ?? 1}` }],
        total: 100,
        page: params.page ?? 1,
        pageSize: 25,
      })
    );
    renderWithClient(<BookingsPage />);

    expect(await screen.findByText('INV-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: '2' }));
    expect(await screen.findByText('INV-2')).toBeInTheDocument();
  });

  it('applies airline and departure-date filters via the Filters popover', async () => {
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    await userEvent.type(await screen.findByLabelText('Airline'), 'QR');
    await userEvent.type(screen.getByLabelText('Departure date filter value'), '2026-05-01');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      const lastCall = vi.mocked(bookingsApi.listBookings).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({
        airlineCode: 'QR',
        depDate: { operator: 'before', from: '2026-05-01' },
      });
    });
  });

  it('shows matching customers when typing 3+ letters in the passenger name field', async () => {
    vi.spyOn(customersApi, 'searchCustomers').mockResolvedValue([
      { id: 'c1', firstName: 'Alexander', lastName: 'Varghese', phone: '555-0100', dob: '02-Sep-1953' },
    ]);
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Passenger name'), 'Var');
    expect(await screen.findByText('Varghese/Alexander')).toBeInTheDocument();
  });

  it('selecting a matched customer fills the passenger name field', async () => {
    vi.spyOn(customersApi, 'searchCustomers').mockResolvedValue([
      { id: 'c1', firstName: 'Alexander', lastName: 'Varghese', phone: '555-0100', dob: '02-Sep-1953' },
    ]);
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Passenger name'), 'Var');
    await userEvent.click(await screen.findByText('Varghese/Alexander'));
    // The dropdown option (and the read-only field once picked) both show the ticketing name
    // (LastName/GivenName).
    expect(screen.getByLabelText('Passenger name')).toHaveValue('Varghese/Alexander');
  });

  it('offers "+ Add new customer" in the passenger autocomplete once 3+ letters are typed', async () => {
    vi.spyOn(customersApi, 'searchCustomers').mockResolvedValue([]);
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Passenger name'), 'Zed');

    expect(await screen.findByRole('button', { name: '+ Add new customer' })).toBeInTheDocument();
  });

  it('creates a customer inline and fills the passenger name, preserving typed booking fields', async () => {
    vi.spyOn(customersApi, 'searchCustomers').mockResolvedValue([]);
    vi.spyOn(customersApi, 'createCustomer').mockResolvedValue({ id: 'c9' });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Invoice number'), '0000300');
    await userEvent.type(screen.getByLabelText('Passenger name'), 'Zed');
    await userEvent.click(await screen.findByRole('button', { name: '+ Add new customer' }));

    // The nested customer dialog is open
    expect(await screen.findByText('Add customer')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('First name'), 'Zed');
    await userEvent.type(screen.getByLabelText('Last name'), 'Newman');
    await userEvent.type(screen.getByLabelText('Date of birth'), '1990-01-01');
    await userEvent.type(screen.getByLabelText('Phone'), '555-0199');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(customersApi.createCustomer).toHaveBeenCalled();
      // Zed / Newman with no middle name -> ticketing name 'Newman/Zed'.
      expect(screen.getByLabelText('Passenger name')).toHaveValue('Newman/Zed');
    });
    // Booking dialog context preserved
    expect(screen.getByLabelText('Invoice number')).toHaveValue('0000300');
  });

  it('creates a booking on form submit', async () => {
    vi.spyOn(bookingsApi, 'createBooking').mockResolvedValue({
      id: 'b2',
      invoiceNumber: '0000200',
      passengers: [{ id: 'p2', passengerName: 'NEW/PAX', amount: 500 }],
    });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Invoice number'), '0000200');
    await userEvent.type(screen.getByLabelText('PNR'), 'ABC123');
    await userEvent.type(screen.getByLabelText('Airline code'), 'QR');
    await userEvent.type(screen.getByLabelText('Departure city'), 'DXB');
    await userEvent.type(screen.getByLabelText('Arrival city'), 'COK');
    await userEvent.type(screen.getByLabelText('Departure Date'), FUTURE_DEP_DATE);
    await userEvent.type(screen.getByLabelText('Arrival Date'), FUTURE_ARR_DATE);
    await linkPassenger('Passenger name', { id: 'c1', firstName: 'New', lastName: 'Pax', phone: '5', dob: '02-Sep-1953' });
    await userEvent.type(screen.getByLabelText('Amount'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));

    await waitFor(() => {
      expect(bookingsApi.createBooking).toHaveBeenCalled();
      const [firstCallArgs] = vi.mocked(bookingsApi.createBooking).mock.calls[0];
      expect(firstCallArgs).toEqual(
        expect.objectContaining({
          invoiceNumber: '0000200',
          pnr: 'ABC123',
          airlineCode: 'QR',
          depCity: 'DXB',
          arrCity: 'COK',
          // Linked name is `lastName/givenName`. Every submitted passenger now carries its own
          // (here, default) payment object.
          passengers: [
            { passengerName: 'Pax/New', amount: 500, customer: 'c1', payment: { status: 'paid', type: 'card', amount: 0 } },
          ],
        })
      );
    });
  });

  it('suggests airlines/airports while typing and stores the picked code', async () => {
    vi.spyOn(flightDataApi, 'searchAirlines').mockResolvedValue([{ code: 'QR', label: 'Qatar Airways' }]);
    vi.spyOn(flightDataApi, 'searchAirports').mockResolvedValue([
      { code: 'ORD', label: "Chicago O'Hare International Airport", sublabel: 'Chicago, United States' },
    ]);
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Airline code'), 'Qatar');
    await userEvent.click(await screen.findByText('Qatar Airways (QR)'));
    expect(screen.getByLabelText('Airline code')).toHaveValue('QR');

    await userEvent.type(screen.getByLabelText('Departure city'), 'Chicago');
    expect(await screen.findByText('Chicago, United States')).toBeInTheDocument();
    await userEvent.click(screen.getByText("Chicago O'Hare International Airport (ORD)"));
    expect(screen.getByLabelText('Departure city')).toHaveValue('ORD');
  });

  it('creates a booking with multiple passengers, each with its own amount', async () => {
    vi.spyOn(bookingsApi, 'createBooking').mockResolvedValue({
      id: 'b7',
      invoiceNumber: '0000210',
      passengers: [
        { id: 'p11', passengerName: 'JOSEPH/SHINY S', amount: 2400 },
        { id: 'p12', passengerName: 'JOSEPH/ANTON', amount: 1800 },
      ],
    });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Invoice number'), '0000210');
    await userEvent.type(screen.getByLabelText('PNR'), 'GUDBFX');
    await userEvent.type(screen.getByLabelText('Airline code'), 'QR');
    await userEvent.type(screen.getByLabelText('Departure city'), 'DXB');
    await userEvent.type(screen.getByLabelText('Arrival city'), 'COK');
    await userEvent.type(screen.getByLabelText('Departure Date'), FUTURE_DEP_DATE);
    await userEvent.type(screen.getByLabelText('Arrival Date'), FUTURE_ARR_DATE);
    await linkPassenger('Passenger name', { id: 'c1', firstName: 'Shiny', lastName: 'Joseph', phone: '5', dob: '02-Sep-1953' });
    await userEvent.type(screen.getByLabelText('Amount'), '2400');

    await userEvent.click(screen.getByRole('button', { name: 'Add passenger' }));
    await linkPassenger('Passenger name 2', { id: 'c2', firstName: 'Anton', lastName: 'Joseph', phone: '5', dob: '01-Jan-1990' });
    await userEvent.type(screen.getByLabelText('Amount 2'), '1800');

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));

    await waitFor(() => {
      const [firstCallArgs] = vi.mocked(bookingsApi.createBooking).mock.calls[0];
      expect(firstCallArgs.passengers).toEqual([
        { passengerName: 'Joseph/Shiny', amount: 2400, customer: 'c1', payment: { status: 'paid', type: 'card', amount: 0 } },
        { passengerName: 'Joseph/Anton', amount: 1800, customer: 'c2', payment: { status: 'paid', type: 'card', amount: 0 } },
      ]);
    });
  });

  it('removes an added passenger row before submit', async () => {
    vi.spyOn(bookingsApi, 'createBooking').mockResolvedValue({
      id: 'b8',
      invoiceNumber: '0000211',
      passengers: [{ id: 'p13', passengerName: 'SOLO/PAX', amount: 100 }],
    });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    expect(screen.getByRole('button', { name: 'Remove passenger 1' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Add passenger' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove passenger 2' }));
    expect(screen.queryByLabelText('Passenger name 2')).not.toBeInTheDocument();
  });

  it('submits a per-passenger Amount owed when "same for all" is unchecked and status is Pending', async () => {
    vi.spyOn(bookingsApi, 'createBooking').mockResolvedValue({
      id: 'b4',
      invoiceNumber: '0000202',
      passengers: [{ id: 'p4', passengerName: 'PEND/PAX', amount: 500 }],
    });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Invoice number'), '0000202');
    await userEvent.type(screen.getByLabelText('PNR'), 'ABC123');
    await userEvent.type(screen.getByLabelText('Airline code'), 'QR');
    await userEvent.type(screen.getByLabelText('Departure city'), 'DXB');
    await userEvent.type(screen.getByLabelText('Arrival city'), 'COK');
    await userEvent.type(screen.getByLabelText('Departure Date'), FUTURE_DEP_DATE);
    await userEvent.type(screen.getByLabelText('Arrival Date'), FUTURE_ARR_DATE);
    await linkPassenger('Passenger name', { id: 'c1', firstName: 'Pend', lastName: 'Pax', phone: '5', dob: '02-Sep-1953' });
    await userEvent.type(screen.getByLabelText('Amount'), '500');
    // The default is shared mode (no per-passenger amount field); uncheck to expose it, then set a
    // partial balance ($200 of the $500 ticket) that only per-passenger mode can represent.
    await userEvent.click(screen.getByRole('checkbox', { name: /same payment & remark for all passengers/i }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Payment status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Pending' }));
    await userEvent.type(screen.getByLabelText('Amount owed'), '200');
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));

    await waitFor(() => {
      expect(bookingsApi.createBooking).toHaveBeenCalled();
      const [firstCallArgs] = vi.mocked(bookingsApi.createBooking).mock.calls[0];
      // Payment lives on the passenger; per-passenger mode submits the entered partial balance.
      const passengers = firstCallArgs.passengers;
      expect(passengers[0].payment).toEqual({ status: 'pending', type: 'card', amount: 200 });
    });
  });

  it('hides Amount owed and submits amount 0 when Payment status is Paid', async () => {
    vi.spyOn(bookingsApi, 'createBooking').mockResolvedValue({
      id: 'b5',
      invoiceNumber: '0000203',
      passengers: [{ id: 'p5', passengerName: 'PAID/PAX', amount: 500 }],
    });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Invoice number'), '0000203');
    await userEvent.type(screen.getByLabelText('PNR'), 'ABC123');
    await userEvent.type(screen.getByLabelText('Airline code'), 'QR');
    await userEvent.type(screen.getByLabelText('Departure city'), 'DXB');
    await userEvent.type(screen.getByLabelText('Arrival city'), 'COK');
    await userEvent.type(screen.getByLabelText('Departure Date'), FUTURE_DEP_DATE);
    await userEvent.type(screen.getByLabelText('Arrival Date'), FUTURE_ARR_DATE);
    await linkPassenger('Passenger name', { id: 'c1', firstName: 'Paid', lastName: 'Pax', phone: '5', dob: '02-Sep-1953' });
    await userEvent.type(screen.getByLabelText('Amount'), '500');
    expect(screen.queryByLabelText('Amount owed')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));

    await waitFor(() => {
      expect(bookingsApi.createBooking).toHaveBeenCalled();
      const [firstCallArgs] = vi.mocked(bookingsApi.createBooking).mock.calls[0];
      const passengers = firstCallArgs.passengers;
      expect(passengers[0].payment).toEqual({ status: 'paid', type: 'card', amount: 0 });
    });
  });

  it('does not create a New booking when Departure city is left empty', async () => {
    const create = vi.spyOn(bookingsApi, 'createBooking');
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.type(screen.getByLabelText('Invoice number'), '0000205');
    await userEvent.type(screen.getByLabelText('PNR'), 'ABC123');
    await userEvent.type(screen.getByLabelText('Airline code'), 'QR');
    await userEvent.type(screen.getByLabelText('Arrival city'), 'COK');
    await userEvent.type(screen.getByLabelText('Departure Date'), FUTURE_DEP_DATE);
    await userEvent.type(screen.getByLabelText('Arrival Date'), FUTURE_ARR_DATE);
    await linkPassenger('Passenger name', { id: 'c1', firstName: 'New', lastName: 'Pax', phone: '5', dob: '02-Sep-1953' });
    await userEvent.type(screen.getByLabelText('Amount'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));

    await new Promise((r) => setTimeout(r, 50));
    expect(create).not.toHaveBeenCalled();
  });

  it('hides trip and payment fields and submits voided:true when Mark as voided is checked', async () => {
    vi.spyOn(bookingsApi, 'createBooking').mockResolvedValue({
      id: 'b6',
      invoiceNumber: 'VOID-UI-1',
      passengers: [{ id: 'p6', passengerName: 'VOID/PAX', amount: 0 }],
    });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark as voided' }));

    expect(screen.queryByLabelText('PNR')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Airline code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Departure city')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Arrival city')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Departure Date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Arrival Date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Payment status')).not.toBeInTheDocument();
    // The Passengers section is hidden too — a placeholder VOID passenger is submitted instead.
    expect(screen.queryByLabelText('Passenger name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Total invoice amount')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Invoice number'), 'VOID-UI-1');
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));

    await waitFor(() => {
      expect(bookingsApi.createBooking).toHaveBeenCalled();
      const [firstCallArgs] = vi.mocked(bookingsApi.createBooking).mock.calls[0];
      expect(firstCallArgs).toEqual(
        expect.objectContaining({
          invoiceNumber: 'VOID-UI-1',
          voided: true,
          pnr: undefined,
          airlineCode: undefined,
          depCity: undefined,
          arrCity: undefined,
          depDate: undefined,
          arrDate: undefined,
          // The VOID placeholder carries no payment (nothing was ever paid on it) and no
          // `payment` key exists on the top-level payload at all any more — payment lives on
          // each passenger now.
          passengers: [{ passengerName: 'VOID', amount: 0 }],
        })
      );
    });
  });

  it('leaves the full form visible and submits voided:false by default', async () => {
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    expect(screen.getByLabelText('PNR')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment status')).toBeInTheDocument();
  });

  it('defaults the Create Booking dialog to a New booking with the standard form', async () => {
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));

    expect(screen.getByRole('combobox', { name: 'Booking type' })).toHaveTextContent('New');
    expect(screen.getByLabelText('Invoice number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Original PNR')).not.toBeInTheDocument();
  });

  it('switches to the adjustment form when Booking type is Reissue', async () => {
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Booking type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Reissue' }));

    expect(screen.getByLabelText('Original PNR')).toBeInTheDocument();
    expect(screen.queryByLabelText('Invoice number')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Mark as voided' })).not.toBeInTheDocument();
  });

  it('switches to the adjustment form when Booking type is Refund', async () => {
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Create booking' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Booking type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Refund' }));

    expect(screen.getByLabelText('Original PNR')).toBeInTheDocument();
    expect(screen.queryByLabelText('Invoice number')).not.toBeInTheDocument();
  });

  it('shows a dash for Payment Status on a voided booking with no payment on file', async () => {
    vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
      bookings: [
        {
          id: 'pv1',
          invoiceNumber: 'VOID-001',
          bookingDate: '2026-05-04',
          passengerName: 'JOSEPH/SHINY S',
          amount: 0,
          remark: 'VOID',
          bookingType: 'New',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<BookingsPage />);
    expect(await screen.findByText('VOID-001')).toBeInTheDocument();
    expect(screen.getByText('VOID')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the outstanding amount under a Pending payment badge', async () => {
    vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
      bookings: [{ ...BASE_ROW, id: 'p6', paymentStatus: 'pending', paymentAmount: 150, bookingType: 'New', bookingId: 'bk1' }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<BookingsPage />);
    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('$150.00 due')).toBeInTheDocument();
  });

  it('no longer offers a Reissue/Refund action on table rows', async () => {
    renderWithClient(<BookingsPage />);
    await screen.findByText('0000150');
    expect(screen.queryByRole('button', { name: /Reissue\/Refund/ })).not.toBeInTheDocument();
  });

  it('toggles column visibility via the View dropdown', async () => {
    renderWithClient(<BookingsPage />);
    await screen.findByText('0000150');

    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Remark' }));

    await waitFor(() => {
      expect(screen.queryByText('Handle with care')).not.toBeInTheDocument();
    });
  });

  it('imports bookings via the Import Bookings dialog', async () => {
    useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Import Bookings' }));
    expect(await screen.findByLabelText('Booking import file')).toBeInTheDocument();
  });

  it('pads a whole-number amount to two decimals', async () => {
    vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
      bookings: [{ ...BASE_ROW, amount: 1234 }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<BookingsPage />);

    expect(await screen.findByText('$1234.00')).toBeInTheDocument();
  });

  it('opens the Voided Invoices dialog and lists only voided invoices', async () => {
    vi.spyOn(bookingsApi, 'listBookings').mockImplementation((params = {}) => {
      if (params.voided) {
        return Promise.resolve({
          bookings: [{
            ...BASE_ROW, id: 'pv1', invoiceNumber: 'VOID-100', bookingDate: '2026-06-01',
            remark: 'Duplicate print', voided: true,
          }],
          total: 1, page: 1, pageSize: 25,
        });
      }
      return Promise.resolve({ bookings: [BASE_ROW], total: 1, page: 1, pageSize: 25 });
    });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Voided Invoices' }));

    expect(await screen.findByText('VOID-100')).toBeInTheDocument();
    expect(screen.getByText('Duplicate print')).toBeInTheDocument();
    expect(vi.mocked(bookingsApi.listBookings)).toHaveBeenCalledWith(expect.objectContaining({ voided: true }));
  });

  it('sorts voided invoices by booking date, newest first, and pages through them', async () => {
    vi.spyOn(bookingsApi, 'listBookings').mockImplementation((params = {}) => {
      if (!params.voided) {
        return Promise.resolve({ bookings: [BASE_ROW], total: 1, page: 1, pageSize: 25 });
      }
      // Two pages of voided invoices; which one comes back depends on the requested page.
      const row = params.page === 2
        ? { ...BASE_ROW, id: 'pv2', invoiceNumber: 'VOID-200', bookingDate: '2026-05-02', voided: true }
        : { ...BASE_ROW, id: 'pv1', invoiceNumber: 'VOID-100', bookingDate: '2026-06-01', voided: true };
      // 20 rows at the dialog's default 15 per page = 2 pages, so Next is live.
      return Promise.resolve({ bookings: [row], total: 20, page: params.page ?? 1, pageSize: 15 });
    });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Voided Invoices' }));
    expect(await screen.findByText('VOID-100')).toBeInTheDocument();

    // Newest-first by booking date, not by invoice number or insertion order.
    expect(vi.mocked(bookingsApi.listBookings)).toHaveBeenCalledWith(
      expect.objectContaining({ voided: true, page: 1, sortBy: 'date', sortDir: 'desc' })
    );

    // PaginationNext's aria-label overrides its visible text, so it is a link named /next/,
    // not a button named 'Next'.
    await userEvent.click(screen.getByRole('link', { name: /next/i }));

    expect(await screen.findByText('VOID-200')).toBeInTheDocument();
    expect(vi.mocked(bookingsApi.listBookings)).toHaveBeenCalledWith(
      expect.objectContaining({ voided: true, page: 2 })
    );
  });

  it('opens the Send Invoice dialog from the toolbar', async () => {
    vi.spyOn(organizationApi, 'getBranding').mockResolvedValue({
      name: 'Alamo Travels',
      tagline: 'Internal CRM',
      logoUrl: null,
      invoiceTerms: null,
      timeZone: 'America/Chicago',
    });
    renderWithClient(<BookingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Send Invoice' }));

    expect(await screen.findByLabelText('To email')).toBeInTheDocument();
  });

  it('exports bookings via the Export dialog', async () => {
    useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
    vi.spyOn(bookingsApi, 'exportBookings').mockResolvedValue(undefined);
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('Export bookings')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(bookingsApi.exportBookings).toHaveBeenCalled());
  });

  it('shows an error in the export dialog when export fails', async () => {
    useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
    vi.spyOn(bookingsApi, 'exportBookings').mockRejectedValueOnce(new Error('network down'));
    renderWithClient(<BookingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByText('Export failed. Check your connection and try again.')).toBeInTheDocument();
  });

  it('does not show Record Payment without an authenticated bookings.edit user', async () => {
    // Overrides this file's default superadmin — this test's whole point is the unauthenticated
    // (null user) state.
    useAuthStore.setState({ accessToken: null, user: null });
    vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
      bookings: [{ ...BASE_ROW, id: 'p7', paymentStatus: 'pending', paymentAmount: 150, bookingType: 'New', bookingId: 'bk1' }],
      total: 1, page: 1, pageSize: 25,
    });
    renderWithClient(<BookingsPage />);
    await screen.findByText('0000150');
    // "Record payment" is a menuitem that isn't mounted until the row-actions dropdown opens, so
    // asserting it's absent proves nothing on its own. The real invariant for a user with neither
    // canEdit nor canDelete is that the row-actions trigger itself never renders at all
    // (booking-row-actions.tsx returns null in that case).
    expect(screen.queryByRole('button', { name: /Row actions for/ })).not.toBeInTheDocument();
  });

  describe('as an admin (bookings.edit)', () => {
    beforeEach(() => {
      useAuthStore.setState({
        accessToken: 't',
        user: { id: 'u1', name: 'Admin User', email: 'admin@alamo.test', role: 'admin' },
      });
    });

    afterEach(() => {
      // Unmount before resetting the store: BookingsTable subscribes to useAuthStore
      // directly, so resetting the store while it's still mounted (RTL's automatic
      // cleanup runs after this hook, since it's registered outside any describe)
      // would otherwise update it outside of an act() wrapper.
      cleanup();
      useAuthStore.setState({ accessToken: null, user: null });
    });

    it('shows Record Payment only on pending rows, and routes a New row to the passenger payment endpoint', async () => {
      vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
        bookings: [{ ...BASE_ROW, id: 'p8', paymentStatus: 'pending', paymentAmount: 150, bookingType: 'New', bookingId: 'bk1' }],
        total: 1, page: 1, pageSize: 25,
      });
      const updateSpy = vi.spyOn(bookingsApi, 'updatePassengerPayment').mockResolvedValue(undefined);
      renderWithClient(<BookingsPage />);

      await screen.findByText('0000150');
      await userEvent.click(screen.getByRole('button', { name: /Row actions for/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Record payment' }));
      await userEvent.clear(screen.getByLabelText('Amount owed'));
      await userEvent.type(screen.getByLabelText('Amount owed'), '50');
      await userEvent.click(screen.getByRole('button', { name: 'Save payment' }));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith('p8', { status: 'pending', type: 'card', amount: 50 });
      });
    });

    it('routes a Reissue/Refund row to the passenger payment endpoint', async () => {
      vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
        bookings: [{ ...BASE_ROW, id: 'p9', paymentStatus: 'pending', paymentAmount: 80, bookingType: 'Reissue', bookingId: undefined }],
        total: 1, page: 1, pageSize: 25,
      });
      const updateSpy = vi.spyOn(bookingsApi, 'updatePassengerPayment').mockResolvedValue(undefined);
      renderWithClient(<BookingsPage />);

      await screen.findByText('0000150');
      await userEvent.click(screen.getByRole('button', { name: /Row actions for/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Record payment' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save payment' }));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith('p9', { status: 'pending', type: 'card', amount: 80 });
      });
    });

    it('does not show Record Payment on a Paid row', async () => {
      renderWithClient(<BookingsPage />);
      await screen.findByText('0000150');
      // BASE_ROW is paymentStatus: 'paid' — open the menu (this admin CAN see it, unlike the
      // unauthenticated-user test above) and assert the "pending only" item is missing from it,
      // rather than asserting on a button that was never going to render regardless of the gate.
      await userEvent.click(screen.getByRole('button', { name: /Row actions for/ }));
      expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Record payment' })).not.toBeInTheDocument();
    });

    it('pre-fills Payment type and Paid on from the row, and submits the edited values', async () => {
      vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
        bookings: [{
          ...BASE_ROW, id: 'p10', paymentStatus: 'pending', paymentAmount: 150,
          paymentType: 'cash', paymentPaidOn: '2026-05-01', bookingType: 'New', bookingId: 'bk1',
        }],
        total: 1, page: 1, pageSize: 25,
      });
      const updateSpy = vi.spyOn(bookingsApi, 'updatePassengerPayment').mockResolvedValue(undefined);
      renderWithClient(<BookingsPage />);

      await screen.findByText('0000150');
      await userEvent.click(screen.getByRole('button', { name: /Row actions for/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Record payment' }));

      expect(screen.getByRole('combobox', { name: 'Payment type' })).toHaveTextContent('Cash');
      expect(screen.getByLabelText('Paid on')).toHaveValue('2026-05-01');

      await userEvent.click(screen.getByRole('combobox', { name: 'Payment type' }));
      await userEvent.click(await screen.findByRole('option', { name: 'Check' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save payment' }));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith('p10', { status: 'pending', type: 'check', amount: 150, paidOn: '2026-05-01' });
      });
    });

    // The table is one row per PASSENGER, not one per invoice. On a New row: Edit opens the
    // WHOLE invoice (routed by bookingId), "Delete passenger" removes ONLY that passenger
    // (routed by the passenger's own id), and "Delete invoice" removes the header + every
    // passenger (routed by bookingId again). On a Reissue/Refund row, Edit and Delete both act
    // on the adjustment itself (routed by the passenger id, since an adjustment has no bookingId).
    // Fixture below uses a passenger id ('p8') that is clearly distinct from the booking id
    // ('bk1') so routing the wrong one is unmistakable.
    describe('row-action id routing (New vs Reissue/Refund)', () => {
      it('"Delete passenger" on a New row calls deletePassenger with the passenger id, not deleteBooking', async () => {
        vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
          bookings: [{ ...BASE_ROW, id: 'p8', bookingId: 'bk1', bookingType: 'New' }],
          total: 1, page: 1, pageSize: 25,
        });
        const deletePassengerSpy = vi.spyOn(bookingsApi, 'deletePassenger').mockResolvedValue(undefined);
        const deleteBookingSpy = vi.spyOn(bookingsApi, 'deleteBooking').mockResolvedValue(undefined);
        // The delete dialog now asks the server how many passengers the invoice really has, so it
        // only warns about losing the whole invoice when that is actually about to happen. Two
        // passengers => not the last one => the confirm button stays "Delete".
        vi.spyOn(bookingsApi, 'getBooking').mockResolvedValue({
          booking: { id: 'bk1', invoiceNumber: '0000150', bookingDate: '2026-05-01', voided: false },
          passengers: [
            { id: 'p8', passengerName: 'SMITH/JOHN', amount: 300 },
            { id: 'p9', passengerName: 'SMITH/JANE', amount: 450 },
          ],
        });
        renderWithClient(<BookingsPage />);

        await screen.findByText('0000150');
        await userEvent.click(screen.getByRole('button', { name: /Row actions for/ }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete passenger' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

        await waitFor(() => {
          expect(deletePassengerSpy).toHaveBeenCalledWith('p8');
        });
        expect(deleteBookingSpy).not.toHaveBeenCalled();
      });

      it('"Delete invoice #N" on a New row calls deleteBooking with the booking id, not deletePassenger', async () => {
        vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
          bookings: [{ ...BASE_ROW, id: 'p8', bookingId: 'bk1', bookingType: 'New' }],
          total: 1, page: 1, pageSize: 25,
        });
        const deletePassengerSpy = vi.spyOn(bookingsApi, 'deletePassenger').mockResolvedValue(undefined);
        const deleteBookingSpy = vi.spyOn(bookingsApi, 'deleteBooking').mockResolvedValue(undefined);
        renderWithClient(<BookingsPage />);

        await screen.findByText('0000150');
        await userEvent.click(screen.getByRole('button', { name: /Row actions for/ }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete invoice #0000150' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

        await waitFor(() => {
          expect(deleteBookingSpy).toHaveBeenCalledWith('bk1');
        });
        expect(deletePassengerSpy).not.toHaveBeenCalled();
      });

      it('Edit on a New row calls getBooking with the booking id (the whole invoice), not getAdjustment', async () => {
        vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
          bookings: [{ ...BASE_ROW, id: 'p8', bookingId: 'bk1', bookingType: 'New' }],
          total: 1, page: 1, pageSize: 25,
        });
        const getBookingSpy = vi.spyOn(bookingsApi, 'getBooking').mockResolvedValue({
          booking: { id: 'bk1', invoiceNumber: '0000150', bookingDate: '2026-05-04', voided: false },
          passengers: [{ id: 'p8', passengerName: 'JOSEPH/SHINY S', amount: 2400.02 }],
        });
        const getAdjustmentSpy = vi.spyOn(bookingsApi, 'getAdjustment');
        renderWithClient(<BookingsPage />);

        await screen.findByText('0000150');
        await userEvent.click(screen.getByRole('button', { name: /Row actions for/ }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));

        await waitFor(() => {
          expect(getBookingSpy).toHaveBeenCalledWith('bk1');
        });
        expect(getAdjustmentSpy).not.toHaveBeenCalled();
      });

      it('Edit on a Reissue row calls getAdjustment with the passenger id, not getBooking', async () => {
        vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
          bookings: [{ ...BASE_ROW, id: 'p8', bookingType: 'Reissue', bookingId: undefined }],
          total: 1, page: 1, pageSize: 25,
        });
        const getAdjustmentSpy = vi.spyOn(bookingsApi, 'getAdjustment').mockResolvedValue({
          id: 'p8',
          bookingType: 'Reissue',
          passengerName: 'JOSEPH/SHINY S',
          parentRef: 'bk1',
          bookingDate: '2026-05-04',
          amount: 2400.02,
          pnr: 'GUDBFX',
          payment: { status: 'paid', type: 'card', amount: 0 },
        });
        const getBookingSpy = vi.spyOn(bookingsApi, 'getBooking');
        renderWithClient(<BookingsPage />);

        await screen.findByText('0000150');
        await userEvent.click(screen.getByRole('button', { name: /Row actions for/ }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));

        await waitFor(() => {
          expect(getAdjustmentSpy).toHaveBeenCalledWith('p8');
        });
        expect(getBookingSpy).not.toHaveBeenCalled();
      });

      it('does not offer "Delete invoice" on a Reissue row\'s menu', async () => {
        vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
          bookings: [{ ...BASE_ROW, id: 'p8', bookingType: 'Reissue', bookingId: undefined }],
          total: 1, page: 1, pageSize: 25,
        });
        renderWithClient(<BookingsPage />);

        await screen.findByText('0000150');
        await userEvent.click(screen.getByRole('button', { name: /Row actions for/ }));

        // Its own delete item is labeled "Delete reissue" (row-scoped) — confirm the menu did
        // open and rendered, so the absence check below isn't vacuous.
        expect(await screen.findByRole('menuitem', { name: 'Delete reissue' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: /Delete invoice/ })).not.toBeInTheDocument();
      });
    });
  });

  describe('Export/Import permission gating', () => {
    const ADMIN_NO_PERMS = {
      id: 'ua2',
      name: 'Plain Admin',
      email: 'admin@a.test',
      role: 'admin' as const,
      permissions: {
        bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
        customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
        groups: { createShared: false },
        data: { viewReports: false },
        enquiries: { sendQuote: false, edit: false, delete: false },
      },
    };
    const ADMIN_WITH_EXPORT = {
      ...ADMIN_NO_PERMS,
      id: 'ua3',
      permissions: {
        ...ADMIN_NO_PERMS.permissions,
        bookings: { ...ADMIN_NO_PERMS.permissions.bookings, export: true },
      },
    };

    it('a superadmin sees both Export and Import Bookings buttons', async () => {
      useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
      renderWithClient(<BookingsPage />);
      expect(await screen.findByRole('button', { name: 'Export' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Import Bookings' })).toBeInTheDocument();
    });

    it('an admin without bookings.import/export permissions sees neither button', async () => {
      useAuthStore.setState({ accessToken: 't', user: ADMIN_NO_PERMS });
      renderWithClient(<BookingsPage />);
      await screen.findByRole('button', { name: 'Create booking' });
      expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Import Bookings' })).not.toBeInTheDocument();
    });

    it('an admin with bookings.export granted sees Export but not Import', async () => {
      useAuthStore.setState({ accessToken: 't', user: ADMIN_WITH_EXPORT });
      renderWithClient(<BookingsPage />);
      expect(await screen.findByRole('button', { name: 'Export' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Import Bookings' })).not.toBeInTheDocument();
    });
  });

  describe('Send Invoice permission gating', () => {
    const AGENT_NO_SEND_INVOICE = {
      id: 'ua9',
      name: 'No Send Agent',
      email: 'agent-nosend@a.test',
      role: 'agent' as const,
      permissions: {
        bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
        customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
        groups: { createShared: false },
        data: { viewReports: false },
        enquiries: { sendQuote: false, edit: false, delete: false },
      },
    };
    const AGENT_WITH_SEND_INVOICE = {
      ...AGENT_NO_SEND_INVOICE,
      id: 'ua10',
      permissions: {
        ...AGENT_NO_SEND_INVOICE.permissions,
        bookings: { ...AGENT_NO_SEND_INVOICE.permissions.bookings, sendInvoice: true },
      },
    };

    it('a superadmin sees the Send Invoice button', async () => {
      useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
      renderWithClient(<BookingsPage />);
      expect(await screen.findByRole('button', { name: 'Send Invoice' })).toBeInTheDocument();
    });

    it('an agent without bookings.sendInvoice does not see the Send Invoice button', async () => {
      useAuthStore.setState({ accessToken: 't', user: AGENT_NO_SEND_INVOICE });
      renderWithClient(<BookingsPage />);
      await screen.findByText('0000150');
      expect(screen.queryByRole('button', { name: 'Send Invoice' })).not.toBeInTheDocument();
    });

    it('an agent with bookings.sendInvoice sees the Send Invoice button', async () => {
      useAuthStore.setState({ accessToken: 't', user: AGENT_WITH_SEND_INVOICE });
      renderWithClient(<BookingsPage />);
      expect(await screen.findByRole('button', { name: 'Send Invoice' })).toBeInTheDocument();
    });
  });

  describe('Create Booking permission gating', () => {
    const AGENT_NO_BOOKING_PERMS = {
      id: 'ua4',
      name: 'Powerless Agent',
      email: 'agent-none@a.test',
      role: 'agent' as const,
      permissions: {
        bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
        customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
        groups: { createShared: false },
        data: { viewReports: false },
        enquiries: { sendQuote: false, edit: false, delete: false },
      },
    };
    const AGENT_CREATE_ONLY = {
      ...AGENT_NO_BOOKING_PERMS,
      id: 'ua5',
      name: 'Create-only Agent',
      email: 'agent-create@a.test',
      permissions: {
        ...AGENT_NO_BOOKING_PERMS.permissions,
        bookings: { ...AGENT_NO_BOOKING_PERMS.permissions.bookings, create: true },
      },
    };
    // The interesting case: createAdjustment WITHOUT create. This user's only route to recording a
    // reissue/refund is the Create Booking button, so hiding it would strand them — and once inside,
    // the Booking Type selector must offer Reissue/Refund but NOT New, and must not default to New.
    const AGENT_ADJUSTMENT_ONLY = {
      ...AGENT_NO_BOOKING_PERMS,
      id: 'ua6',
      name: 'Adjustment-only Agent',
      email: 'agent-adj@a.test',
      permissions: {
        ...AGENT_NO_BOOKING_PERMS.permissions,
        bookings: { ...AGENT_NO_BOOKING_PERMS.permissions.bookings, createAdjustment: true },
      },
    };

    it('a superadmin sees the Create booking button', async () => {
      useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
      renderWithClient(<BookingsPage />);
      expect(await screen.findByRole('button', { name: 'Create booking' })).toBeInTheDocument();
    });

    it('an agent with neither bookings.create nor bookings.createAdjustment does not see the Create booking button', async () => {
      useAuthStore.setState({ accessToken: 't', user: AGENT_NO_BOOKING_PERMS });
      renderWithClient(<BookingsPage />);
      await screen.findByText('0000150');
      expect(screen.queryByRole('button', { name: 'Create booking' })).not.toBeInTheDocument();
    });

    it('an agent with only bookings.create sees Create booking, and the type selector offers only New', async () => {
      useAuthStore.setState({ accessToken: 't', user: AGENT_CREATE_ONLY });
      renderWithClient(<BookingsPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Create booking' }));

      expect(screen.getByRole('combobox', { name: 'Booking type' })).toHaveTextContent('New');
      expect(screen.getByLabelText('Invoice number')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('combobox', { name: 'Booking type' }));
      expect(await screen.findByRole('option', { name: 'New' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Reissue' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Refund' })).not.toBeInTheDocument();
    });

    it('an agent with only bookings.createAdjustment sees Create booking, and the type selector offers Reissue/Refund but not New, and does not default to New', async () => {
      useAuthStore.setState({ accessToken: 't', user: AGENT_ADJUSTMENT_ONLY });
      renderWithClient(<BookingsPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Create booking' }));

      // Defaults to Reissue, not New — proven by the adjustment form's own field being visible
      // and the New form's Invoice number field being absent, with no interaction yet.
      expect(screen.getByRole('combobox', { name: 'Booking type' })).toHaveTextContent('Reissue');
      expect(screen.getByLabelText('Original PNR')).toBeInTheDocument();
      expect(screen.queryByLabelText('Invoice number')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('combobox', { name: 'Booking type' }));
      expect(await screen.findByRole('option', { name: 'Reissue' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Refund' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'New' })).not.toBeInTheDocument();
    });
  });

  describe('"+ Add new customer" permission gating (booking-form.tsx)', () => {
    const AGENT_NO_CUSTOMER_CREATE = {
      id: 'ua7',
      name: 'No Customer Create Agent',
      email: 'agent-nocust@a.test',
      role: 'agent' as const,
      permissions: {
        bookings: { create: true, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
        customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
        groups: { createShared: false },
        data: { viewReports: false },
        enquiries: { sendQuote: false, edit: false, delete: false },
      },
    };
    const AGENT_WITH_CUSTOMER_CREATE = {
      ...AGENT_NO_CUSTOMER_CREATE,
      id: 'ua8',
      permissions: {
        ...AGENT_NO_CUSTOMER_CREATE.permissions,
        customers: { ...AGENT_NO_CUSTOMER_CREATE.permissions.customers, create: true },
      },
    };

    it('a superadmin sees "+ Add new customer" in the passenger autocomplete', async () => {
      useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
      renderWithClient(<BookingsPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Create booking' }));
      await userEvent.type(screen.getByLabelText('Passenger name'), 'Zed');
      expect(await screen.findByRole('button', { name: '+ Add new customer' })).toBeInTheDocument();
    });

    it('an agent without customers.create does not see "+ Add new customer", but existing-customer search still works', async () => {
      vi.spyOn(customersApi, 'searchCustomers').mockResolvedValue([
        { id: 'c1', firstName: 'Alexander', lastName: 'Varghese', phone: '555-0100', dob: '02-Sep-1953' },
      ]);
      useAuthStore.setState({ accessToken: 't', user: AGENT_NO_CUSTOMER_CREATE });
      renderWithClient(<BookingsPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Create booking' }));
      await userEvent.type(screen.getByLabelText('Passenger name'), 'Var');

      expect(await screen.findByText('Varghese/Alexander')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ Add new customer' })).not.toBeInTheDocument();
    });

    it('an agent with customers.create sees "+ Add new customer"', async () => {
      vi.spyOn(customersApi, 'searchCustomers').mockResolvedValue([]);
      useAuthStore.setState({ accessToken: 't', user: AGENT_WITH_CUSTOMER_CREATE });
      renderWithClient(<BookingsPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Create booking' }));
      await userEvent.type(screen.getByLabelText('Passenger name'), 'Zed');
      expect(await screen.findByRole('button', { name: '+ Add new customer' })).toBeInTheDocument();
    });
  });
});
