import { render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_TIME_ZONE, agencyToday } from '@/utils/agencyTime';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { AdjustmentBookingForm } from './adjustment-booking-form';
import * as bookingsApi from '@/api/bookings.api';
import { FUTURE_ARR_DATE, FUTURE_DEP_DATE } from '@/test-utils/dates';

// The components floor these date inputs on `agencyToday(timeZone)` — the AGENCY-local calendar
// day (America/Chicago by default; none of these tests mocks branding, so the fallback applies).
// This constant used to be `new Date().toISOString().slice(0, 10)`, i.e. the UTC day, which agrees
// with the agency day only for the 18-19 hours a day that UTC and Chicago share a date. Between
// 00:00 UTC and local midnight — 19:00-24:00 Chicago time — UTC is already tomorrow and all three
// of these assertions failed, every single night. Deriving the expectation the same way the
// component does removes the skew by construction rather than re-pinning it to a different clock.
const TODAY = agencyToday(DEFAULT_TIME_ZONE);

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const PAX_A: bookingsApi.BookingRow = {
  id: 'p1',
  invoiceNumber: '0000150',
  bookingDate: '2026-05-04',
  passengerName: 'JOSEPH/SHINY S',
  amount: 2400,
  pnr: 'GUDBFX',
  airlineCode: 'QR',
  depCity: 'DXB',
  arrCity: 'COK',
  depDate: '2026-05-08',
  arrDate: '2026-05-28',
  paymentStatus: 'paid',
  bookingType: 'New',
  bookingId: 'bk0',
};

const PAX_B: bookingsApi.BookingRow = {
  ...PAX_A,
  id: 'p2',
  passengerName: 'JOSEPH/ANTON',
  amount: 1800,
};

const ADJUSTMENT_ROW: bookingsApi.BookingRow = {
  ...PAX_A,
  id: 'adj-p9',
  passengerName: 'OLD/ADJUSTED',
  bookingType: 'Reissue',
  bookingId: undefined,
};

function mockSearch(rows: bookingsApi.BookingRow[]) {
  return vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
    bookings: rows,
    total: rows.length,
    page: 1,
    pageSize: 50,
  });
}

async function searchAndPickPnr() {
  await userEvent.type(screen.getByLabelText('Original PNR'), 'GUD');
  await userEvent.click(await screen.findByRole('button', { name: /GUDBFX — 0000150 — 2 passengers/ }));
}

describe('AdjustmentBookingForm', () => {
  it('searches by PNR and lists one checked row per New passenger with prefilled amounts', async () => {
    const search = mockSearch([PAX_A, PAX_B, ADJUSTMENT_ROW]);
    renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={vi.fn()} onCancel={vi.fn()} />);

    await searchAndPickPnr();

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: 'GUD', pageSize: 50 }));
    });
    expect(screen.getByRole('checkbox', { name: 'Include JOSEPH/SHINY S' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include JOSEPH/ANTON' })).toBeChecked();
    // Adjustment rows are not offered
    expect(screen.queryByText('OLD/ADJUSTED')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Amount for JOSEPH/SHINY S')).toHaveValue(2400);
    expect(screen.getByLabelText('Amount for JOSEPH/ANTON')).toHaveValue(1800);
    // Shared fields prefilled from the original booking
    expect(screen.getByLabelText('Adjustment PNR')).toHaveValue('GUDBFX');
    expect(screen.getByLabelText('Adjustment airline code')).toHaveValue('QR');
    expect(screen.getByLabelText('Adjustment departure city')).toHaveValue('DXB');
  });

  describe('future-only trip dates', () => {
    it('floors the Reissue trip dates at today', async () => {
      mockSearch([PAX_A, PAX_B]);
      renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={vi.fn()} onCancel={vi.fn()} />);
      await searchAndPickPnr();

      expect(screen.getByLabelText('Adjustment departure date')).toHaveAttribute('min', TODAY);
      expect(screen.getByLabelText('Adjustment arrival date')).toHaveAttribute('min', TODAY);
      // The adjustment's own booking date is a ledger date, not a flight date — never floored.
      expect(screen.getByLabelText('Adjustment booking date')).not.toHaveAttribute('min');
    });

    it('drops a prefilled trip date that has already departed', async () => {
      // PAX_A's flight is in the past. A reissue books a NEW flight, so carrying those dates over
      // would open the form already violating `min` on fields the user never touched.
      mockSearch([PAX_A, PAX_B]);
      renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={vi.fn()} onCancel={vi.fn()} />);
      await searchAndPickPnr();

      expect(screen.getByLabelText('Adjustment departure date')).toHaveValue('');
      expect(screen.getByLabelText('Adjustment arrival date')).toHaveValue('');
      // Everything else still prefills — only the departed dates are dropped.
      expect(screen.getByLabelText('Adjustment departure city')).toHaveValue('DXB');
    });

    it('keeps a prefilled trip date that is still in the future', async () => {
      const upcoming = { ...PAX_A, depDate: FUTURE_DEP_DATE, arrDate: FUTURE_ARR_DATE };
      mockSearch([upcoming, { ...PAX_B, depDate: FUTURE_DEP_DATE, arrDate: FUTURE_ARR_DATE }]);
      renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={vi.fn()} onCancel={vi.fn()} />);
      await searchAndPickPnr();

      expect(screen.getByLabelText('Adjustment departure date')).toHaveValue(FUTURE_DEP_DATE);
      expect(screen.getByLabelText('Adjustment arrival date')).toHaveValue(FUTURE_ARR_DATE);
    });
  });

  it('shows an empty-state message when a PNR matches only adjustment rows', async () => {
    mockSearch([ADJUSTMENT_ROW]);
    renderWithClient(<AdjustmentBookingForm bookingType="Refund" onDone={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Original PNR'), 'GUD');

    expect(await screen.findByText('No adjustable passengers found for this PNR.')).toBeInTheDocument();
  });

  it('renders no city/date fields for a Refund', async () => {
    mockSearch([PAX_A, PAX_B]);
    renderWithClient(<AdjustmentBookingForm bookingType="Refund" onDone={vi.fn()} onCancel={vi.fn()} />);

    await searchAndPickPnr();

    expect(screen.queryByLabelText('Adjustment departure city')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adjustment arrival city')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adjustment departure date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adjustment arrival date')).not.toBeInTheDocument();
  });

  it('submits one adjustment per checked passenger with per-passenger amounts, then calls onDone', async () => {
    mockSearch([PAX_A, PAX_B]);
    const create = vi.spyOn(bookingsApi, 'createAdjustment').mockResolvedValue({
      id: 'adj1',
      bookingType: 'Reissue',
      parentRef: 'p1',
      amount: 280,
    });
    const onDone = vi.fn();
    renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={onDone} onCancel={vi.fn()} />);

    await searchAndPickPnr();
    await userEvent.clear(screen.getByLabelText('Amount for JOSEPH/SHINY S'));
    await userEvent.type(screen.getByLabelText('Amount for JOSEPH/SHINY S'), '280');
    await userEvent.clear(screen.getByLabelText('Adjustment PNR'));
    await userEvent.type(screen.getByLabelText('Adjustment PNR'), 'WXITNF');
    await userEvent.click(screen.getByRole('button', { name: 'Record reissue' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(2);
    });
    expect(create).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ bookingType: 'Reissue', pnr: 'WXITNF', amount: 280, depCity: 'DXB' })
    );
    expect(create).toHaveBeenCalledWith('p2', expect.objectContaining({ pnr: 'WXITNF', amount: 1800 }));
    expect(onDone).toHaveBeenCalled();
  });

  it('excludes an unchecked passenger from submission', async () => {
    mockSearch([PAX_A, PAX_B]);
    const create = vi.spyOn(bookingsApi, 'createAdjustment').mockResolvedValue({
      id: 'adj1',
      bookingType: 'Refund',
      parentRef: 'p1',
      amount: 2400,
    });
    renderWithClient(<AdjustmentBookingForm bookingType="Refund" onDone={vi.fn()} onCancel={vi.fn()} />);

    await searchAndPickPnr();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include JOSEPH/ANTON' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record refund' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
    expect(create).toHaveBeenCalledWith('p1', expect.objectContaining({ bookingType: 'Refund', pnr: 'GUDBFX' }));
    // Refund never submits city/date fields
    const [, payload] = vi.mocked(create).mock.calls[0];
    expect(payload.depCity).toBeUndefined();
    expect(payload.arrCity).toBeUndefined();
    expect(payload.depDate).toBeUndefined();
    expect(payload.arrDate).toBeUndefined();
  });

  it('lists failed passengers and retries only them', async () => {
    mockSearch([PAX_A, PAX_B]);
    const create = vi
      .spyOn(bookingsApi, 'createAdjustment')
      .mockImplementation((passengerId: string) =>
        passengerId === 'p2'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ id: 'adj1', bookingType: 'Refund', parentRef: passengerId, amount: 1 })
      );
    const onDone = vi.fn();
    renderWithClient(<AdjustmentBookingForm bookingType="Refund" onDone={onDone} onCancel={vi.fn()} />);

    await searchAndPickPnr();
    await userEvent.click(screen.getByRole('button', { name: 'Record refund' }));

    expect(await screen.findByText(/Failed for: JOSEPH\/ANTON/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);

    create.mockResolvedValue({ id: 'adj2', bookingType: 'Refund', parentRef: 'p2', amount: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Retry failed' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(3); // only p2 re-sent
      expect(onDone).toHaveBeenCalled();
    });
    expect(vi.mocked(create).mock.calls[2][0]).toBe('p2');
  });

  it('does not submit a Reissue when the departure city is cleared', async () => {
    mockSearch([PAX_A]);
    const create = vi.spyOn(bookingsApi, 'createAdjustment');
    renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Original PNR'), 'GUD');
    await userEvent.click(await screen.findByRole('button', { name: /GUDBFX — 0000150 — 1 passenger/ }));
    // Cities are prefilled from the original booking; clear the departure city to violate the new rule.
    await userEvent.clear(screen.getByLabelText('Adjustment departure city'));
    await userEvent.click(screen.getByRole('button', { name: 'Record reissue' }));

    await new Promise((r) => setTimeout(r, 50));
    expect(create).not.toHaveBeenCalled();
  });

  it('submits pending payment with a shared Amount owed', async () => {
    mockSearch([PAX_A]);
    const create = vi.spyOn(bookingsApi, 'createAdjustment').mockResolvedValue({
      id: 'adj1',
      bookingType: 'Reissue',
      parentRef: 'p1',
      amount: 2400,
    });
    renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Original PNR'), 'GUD');
    await userEvent.click(await screen.findByRole('button', { name: /GUDBFX — 0000150 — 1 passenger/ }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Adjustment payment status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Pending' }));
    await userEvent.type(screen.getByLabelText('Adjustment amount owed'), '80');
    await userEvent.click(screen.getByRole('button', { name: 'Record reissue' }));

    await waitFor(() => {
      const [, payload] = vi.mocked(create).mock.calls[0];
      expect(payload.payment).toEqual({ status: 'pending', type: 'card', amount: 80 });
    });
  });
});
