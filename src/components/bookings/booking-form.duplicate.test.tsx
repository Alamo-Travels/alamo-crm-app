import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FUTURE_ARR_DATE, FUTURE_DEP_DATE } from '@/test-utils/dates';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
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

function duplicate409(): AxiosError {
  const err = new AxiosError('Conflict');
  err.response = {
    status: 409,
    data: {
      error: {
        message: 'Invoice 000005 already exists with the same booking date and PNR.',
        code: 'DUPLICATE_BOOKING_WARNING',
        duplicate: {
          id: 'b1',
          invoiceNumber: '000005',
          bookingDate: '2026-01-03',
          pnr: 'GUDBFX',
          passengerNames: ['John Smith'],
        },
      },
    },
  } as AxiosResponse;
  return err;
}

function renderForm(initial?: BookingDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BookingForm initial={initial} onDone={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>
  );
}

// Same shape as edit-booking-dialog.test.tsx's DETAIL fixture — an existing invoice being edited.
const EXISTING_BOOKING: BookingDetail = {
  booking: {
    id: 'b1',
    invoiceNumber: '000005',
    bookingDate: '2026-01-03',
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

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  vi.mocked(searchCustomers).mockResolvedValue([
    { id: 'c1', firstName: 'Jane', lastName: 'Smith', phone: '555-0100', dob: '02-Sep-1953' },
  ]);
  await user.type(screen.getByLabelText('Invoice#'), '000005');
  await user.type(screen.getByLabelText(/PNR/i), 'GUDBFX');
  await user.type(screen.getByLabelText(/Airline/i), 'QR');
  await user.type(screen.getByLabelText('Departure city'), 'ORD');
  await user.type(screen.getByLabelText('Arrival city'), 'COK');
  fireEvent.change(screen.getByLabelText('Departure Date'), { target: { value: FUTURE_DEP_DATE } });
  fireEvent.change(screen.getByLabelText('Arrival Date'), { target: { value: FUTURE_ARR_DATE } });
  await user.type(screen.getByLabelText(/Passenger name/i), 'Jane');
  await user.click(await screen.findByText('Smith/Jane'));
  await user.type(screen.getByLabelText(/^Amount$/i), '700');
  await user.click(screen.getByRole('button', { name: /create booking/i }));
}

describe('BookingForm duplicate-invoice warning', () => {
  // Clears call history (not the mockResolvedValue implementations set above) between tests —
  // `createBooking`'s mock is module-level and otherwise carries call counts across tests, which
  // makes assertions like `toHaveBeenCalledTimes(1)` check cumulative calls instead of this test's own.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the colliding invoice and re-submits with confirmDuplicate on Save anyway', async () => {
    const user = userEvent.setup();
    vi.mocked(createBooking).mockRejectedValueOnce(duplicate409());
    renderForm();

    await fillAndSubmit(user);

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByText(/John Smith/)).toBeInTheDocument();
    expect(vi.mocked(createBooking).mock.calls[0][0].confirmDuplicate).toBeUndefined();

    vi.mocked(createBooking).mockResolvedValueOnce({ id: 'b2', invoiceNumber: '000005', passengers: [] });
    await user.click(screen.getByRole('button', { name: /save anyway/i }));

    await waitFor(() => expect(createBooking).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createBooking).mock.calls[1][0].confirmDuplicate).toBe(true);
    expect(vi.mocked(createBooking).mock.calls[1][0].invoiceNumber).toBe('000005');
  });

  it('dismissing the warning does not save', async () => {
    const user = userEvent.setup();
    vi.mocked(createBooking).mockRejectedValueOnce(duplicate409());
    renderForm();

    await fillAndSubmit(user);
    await user.click(await screen.findByRole('button', { name: /go back/i }));

    expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Invoice#')).toHaveValue('000005');
  });

  // The round trip above only ever exercised the CREATE branch (`renderForm()` with no
  // `initial`). The spec asked for both dialogs — Edit hits the exact same 409 from
  // `updateBooking`, and "Save anyway" must re-submit through `updateBooking` (not `createBooking`)
  // with the booking's own id and `confirmDuplicate: true`.
  it('EDIT path: shows the colliding invoice and re-submits via updateBooking with confirmDuplicate on Save anyway', async () => {
    const user = userEvent.setup();
    vi.mocked(updateBooking).mockRejectedValueOnce(duplicate409());
    renderForm(EXISTING_BOOKING);

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByText(/John Smith/)).toBeInTheDocument();
    expect(vi.mocked(updateBooking).mock.calls[0][1].confirmDuplicate).toBeUndefined();
    expect(createBooking).not.toHaveBeenCalled();

    vi.mocked(updateBooking).mockResolvedValueOnce(EXISTING_BOOKING);
    await user.click(screen.getByRole('button', { name: /save anyway/i }));

    await waitFor(() => expect(updateBooking).toHaveBeenCalledTimes(2));
    const [id, input] = vi.mocked(updateBooking).mock.calls[1];
    expect(id).toBe('b1');
    expect(input.confirmDuplicate).toBe(true);
    expect(input.invoiceNumber).toBe('000005');
  });

  it('toasts "Booking created" after a successful create', async () => {
    const user = userEvent.setup();
    vi.mocked(createBooking).mockResolvedValue(undefined as never);
    const successSpy = vi.spyOn(toast, 'success');
    renderForm();

    await fillAndSubmit(user);

    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Booking created'));
    successSpy.mockRestore();
  });

  it('toasts "Booking updated" after a successful edit', async () => {
    const user = userEvent.setup();
    vi.mocked(updateBooking).mockResolvedValue(undefined as never);
    const successSpy = vi.spyOn(toast, 'success');
    renderForm(EXISTING_BOOKING);

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Booking updated'));
    expect(vi.mocked(updateBooking)).toHaveBeenCalled();
    expect(vi.mocked(createBooking)).not.toHaveBeenCalled();
    successSpy.mockRestore();
  });
});
