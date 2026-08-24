import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BookingDraftState, BookingForm } from './booking-form';
import { isBookingDraftEmpty } from './isBookingDraftEmpty';
import { useAuthStore } from '@/stores/authStore';
import { readDraft, writeDraft } from '@/utils/formDraft';

vi.mock('@/api/bookings.api', async (importActual) => ({
  ...(await importActual<typeof import('@/api/bookings.api')>()),
  createBooking: vi.fn(),
  updateBooking: vi.fn(),
}));
vi.mock('@/api/customers.api', async (importActual) => ({
  ...(await importActual<typeof import('@/api/customers.api')>()),
  searchCustomers: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/api/flightData.api', async (importActual) => ({
  ...(await importActual<typeof import('@/api/flightData.api')>()),
  searchAirports: vi.fn().mockResolvedValue([]),
  searchAirlines: vi.fn().mockResolvedValue([]),
}));

const USER = { id: 'u1', name: 'Agent', email: 'a@example.com', role: 'superadmin' as const };

function renderForm(onCancel = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BookingForm onDone={vi.fn()} onCancel={onCancel} />
    </QueryClientProvider>
  );
  return { onCancel };
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ accessToken: 't', user: USER });
});

afterEach(() => {
  useAuthStore.setState({ accessToken: null, user: null });
});

describe('BookingForm drafts', () => {
  it('auto-saves what is typed', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('Invoice#'), 'INV-900');

    await waitFor(
      () =>
        expect(
          readDraft<{ form: { invoiceNumber: string } }>('u1', 'booking:new')?.state.form.invoiceNumber
        ).toBe('INV-900'),
      { timeout: 2000 }
    );
  });

  it('offers a stored draft without pre-filling the form, and restores on demand', async () => {
    writeDraft('u1', 'booking:new', {
      form: {
        invoiceNumber: 'INV-777',
        bookingDate: '2026-05-01',
        voided: false,
        pnr: 'ABC123',
        airlineCode: '',
        depCity: '',
        arrCity: '',
        depDate: '',
        arrDate: '',
      },
      passengers: [
        {
          name: 'Doe/John',
          amount: '700',
          paymentStatus: 'paid',
          paymentType: 'card',
          pendingAmount: '',
          paidOn: '',
          remark: '',
        },
      ],
      shareAll: true,
      shared: { paymentStatus: 'paid', paymentType: 'check', paidOn: '', remark: 'Restored booking' },
      totalAmount: '700',
      totalTouched: true,
    });

    renderForm();

    // The bar is offered, and NOTHING is pre-filled.
    expect(screen.getByText(/unfinished draft/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Invoice#')).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    // Every drafted field actually landed — not just Invoice#. A restore that dropped
    // passengers/shareAll/shared/totalAmount would still pass a check of Invoice# alone, which is
    // exactly the hollow-guard shape review flagged: it was proven to fail when `setPassengers` was
    // removed from `handleRestoreDraft` (see the task report's probe output).
    expect(screen.getByLabelText('Invoice#')).toHaveValue('INV-777');
    expect(screen.getByLabelText('Passenger name')).toHaveValue('Doe/John');
    expect(screen.getByLabelText('Amount')).toHaveValue(700);
    expect(screen.getByRole('combobox', { name: 'Payment type' })).toHaveTextContent('Check');
    expect(screen.getByLabelText('Remark')).toHaveValue('Restored booking');
    expect(screen.getByLabelText('Total invoice amount')).toHaveValue(700);
    expect(screen.queryByText(/unfinished draft/i)).not.toBeInTheDocument();
  });

  it('Discard clears storage and hides the bar', async () => {
    writeDraft('u1', 'booking:new', {
      form: { invoiceNumber: 'INV-777', bookingDate: '2026-05-01', voided: false, pnr: '', airlineCode: '', depCity: '', arrCity: '', depDate: '', arrDate: '' },
      passengers: [{ name: '', amount: '', paymentStatus: 'paid', paymentType: 'card', pendingAmount: '', paidOn: '', remark: '' }],
      shareAll: true,
      shared: { paymentStatus: 'paid', paymentType: 'card', paidOn: '', remark: '' },
      totalAmount: '',
      totalTouched: false,
    });

    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(readDraft('u1', 'booking:new')).toBeNull();
    expect(screen.queryByText(/unfinished draft/i)).not.toBeInTheDocument();
  });

  it('Cancel on an untouched form closes immediately, with no confirmation', async () => {
    const { onCancel } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByText(/leave this booking/i)).not.toBeInTheDocument();
  });

  it('Cancel with content asks, and "Discard it" throws the draft away', async () => {
    const { onCancel } = renderForm();
    await userEvent.type(screen.getByLabelText('Invoice#'), 'INV-901');
    await waitFor(() => expect(readDraft('u1', 'booking:new')).not.toBeNull(), { timeout: 2000 });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/leave this booking/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Discard it' }));
    expect(readDraft('u1', 'booking:new')).toBeNull();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('Cancel with content, then "Keep as draft", closes and keeps it', async () => {
    const { onCancel } = renderForm();
    await userEvent.type(screen.getByLabelText('Invoice#'), 'INV-902');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep as draft' }));

    expect(
      readDraft<{ form: { invoiceNumber: string } }>('u1', 'booking:new')?.state.form.invoiceNumber
    ).toBe('INV-902');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  // bookingDate used to be excluded entirely from the emptiness predicate, so changing
  // ONLY the Booking Date (e.g. back-dating a historic invoice) and pressing Cancel closed with no
  // confirmation and no draft. The predicate now compares against what THIS form was seeded with
  // (see isBookingDraftEmpty's docstring) instead of ignoring the field.
  it('Cancel after changing ONLY the Booking Date asks for confirmation, and a draft exists', async () => {
    const { onCancel } = renderForm();
    fireEvent.change(screen.getByLabelText('Booking Date'), { target: { value: '2020-01-01' } });

    await waitFor(
      () =>
        expect(
          readDraft<{ form: { bookingDate: string } }>('u1', 'booking:new')?.state.form.bookingDate
        ).toBe('2020-01-01'),
      { timeout: 2000 }
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/leave this booking/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('"Go back" returns to the form and keeps the draft', async () => {
    const { onCancel } = renderForm();
    await userEvent.type(screen.getByLabelText('Invoice#'), 'INV-903');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(onCancel).not.toHaveBeenCalled();
    await waitFor(() => expect(readDraft('u1', 'booking:new')).not.toBeNull(), { timeout: 2000 });
  });
});

// M3 REGRESSION FIX: the first version of isBookingDraftEmpty compared `form.bookingDate` against a
// freshly-computed `new Date().toISOString()`. But a fresh CREATE form's bookingDate is seeded from
// `emptyForm.bookingDate`, a MODULE-LEVEL value computed ONCE at first page load — never refreshed.
// A tab left open across a UTC day rollover (very plausible for an all-day office CRM) would then
// have a genuinely UNTOUCHED form whose bookingDate is frozen at yesterday while a live "today"
// ticks forward — the two differ, and the form wrongly registers as touched: a spurious "Leave this
// booking?" confirmation and an unwanted draft for a form nobody touched.
//
// This can't be reproduced by mounting the real component and manipulating the system clock (no
// fake timers in this codebase, and the bug is specifically about DIVERGENCE between the module's
// load-time snapshot and a later "now" — not reproducible within one synchronous test run without
// faking time). Instead these tests exercise the fixed predicate DIRECTLY: it takes an explicit
// `seededBookingDate` parameter and no longer calls the clock at all, so its correctness can be
// proven for ANY seed/value pair regardless of what the real "today" happens to be when the test
// runs — which is exactly what the fix guarantees. `isBookingDraftEmpty`/`BookingDraftState` are
// exported from booking-form.tsx solely to make this possible.
describe('isBookingDraftEmpty — seeded-bookingDate regression (M3 fix)', () => {
  const baseForm = {
    invoiceNumber: '',
    bookingDate: '2020-01-01',
    voided: false,
    pnr: '',
    airlineCode: '',
    depCity: '',
    arrCity: '',
    depDate: '',
    arrDate: '',
  };
  const basePassenger = {
    name: '',
    amount: '',
    paymentStatus: 'paid' as const,
    paymentType: 'card' as const,
    pendingAmount: '',
    paidOn: '',
    remark: '',
  };
  const baseState: BookingDraftState = {
    form: baseForm,
    passengers: [basePassenger],
    shareAll: true,
    shared: { paymentStatus: 'paid', paymentType: 'card', paidOn: '', remark: '' },
    totalAmount: '',
    totalTouched: false,
  };

  it('an untouched form is EMPTY even when its seeded bookingDate is nowhere near the real "today"', () => {
    // '2020-01-01' stands in for a form seeded a long time before this test runs (the module-load
    // snapshot). Nothing else in the state was touched, and the form's bookingDate exactly matches
    // what it was seeded with — this must read as empty regardless of the actual current date.
    expect(isBookingDraftEmpty(baseState, '2020-01-01')).toBe(true);
  });

  it('a bookingDate that differs from its OWN seed still counts as content', () => {
    const touched: BookingDraftState = {
      ...baseState,
      form: { ...baseForm, bookingDate: '2020-01-02' },
    };
    expect(isBookingDraftEmpty(touched, '2020-01-01')).toBe(false);
  });
});
