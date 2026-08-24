import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { EditAdjustmentDialog } from './edit-adjustment-dialog';
import * as bookingsApi from '@/api/bookings.api';

vi.mock('@/api/bookings.api');

const REISSUE_DETAIL: bookingsApi.AdjustmentDetail = {
  id: 'a1',
  bookingType: 'Reissue',
  passengerName: 'SMITH/JOHN',
  parentRef: 'p1',
  bookingDate: '2026-06-01',
  amount: 75,
  pnr: 'ABC123',
  airlineCode: 'QR',
  depCity: 'DXB',
  arrCity: 'COK',
  depDate: '2026-07-10',
  arrDate: '2026-07-20',
  remark: '',
  payment: { status: 'paid', type: 'card', amount: 0 },
};

const REFUND_DETAIL: bookingsApi.AdjustmentDetail = {
  id: 'a2',
  bookingType: 'Refund',
  passengerName: 'JONES/JANE',
  parentRef: 'p2',
  bookingDate: '2026-06-05',
  amount: 150,
  pnr: 'XYZ789',
  airlineCode: 'EK',
  depCity: undefined,
  arrCity: undefined,
  depDate: undefined,
  arrDate: undefined,
  remark: 'Customer requested refund',
  payment: { status: 'pending', type: 'card', amount: 0 },
};

function renderDialog(adjustmentId: string = 'a1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EditAdjustmentDialog adjustmentId={adjustmentId} onOpenChange={() => {}} queryKeyPrefix="bookings" />
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(bookingsApi.getAdjustment).mockImplementation((id) => {
    if (id === 'a1') return Promise.resolve(REISSUE_DETAIL);
    if (id === 'a2') return Promise.resolve(REFUND_DETAIL);
    return Promise.reject(new Error('Unknown adjustment'));
  });
  vi.mocked(bookingsApi.updateAdjustment).mockResolvedValue(REISSUE_DETAIL);
});

describe('EditAdjustmentDialog', () => {
  it('prefills the reissue and skips the PNR search step', async () => {
    renderDialog('a1');

    expect(await screen.findByDisplayValue('ABC123')).toBeInTheDocument();
    expect(screen.getByDisplayValue('75')).toBeInTheDocument();
    // The PNR-search + passenger-picker only exist to choose what a NEW adjustment attaches to.
    // An existing one's parentRef is fixed, so neither is rendered.
    expect(screen.queryByLabelText('Original PNR')).not.toBeInTheDocument();
    expect(screen.queryByText(/Include SMITH\/JOHN/)).not.toBeInTheDocument();
  });

  it('does not floor the trip dates — a historic adjustment must stay editable', async () => {
    // The future-only rule applies when ENTERING a new reissue (adjustment-booking-form.tsx), not
    // when correcting one already on the ledger, whose flight may be years past.
    renderDialog('a1');

    expect(await screen.findByLabelText('Adjustment departure date')).not.toHaveAttribute('min');
    expect(screen.getByLabelText('Adjustment arrival date')).not.toHaveAttribute('min');
  });

  it('saves the edited fields', async () => {
    const user = userEvent.setup();
    renderDialog('a1');

    const pnr = await screen.findByDisplayValue('ABC123');
    await user.clear(pnr);
    await user.type(pnr, 'ZZZ999');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateAdjustment).toHaveBeenCalled());
    const [id, input] = vi.mocked(bookingsApi.updateAdjustment).mock.calls[0];
    expect(id).toBe('a1');
    expect(input.pnr).toBe('ZZZ999');
    expect(input.amount).toBe(75);
    // bookingType is never sent — a Reissue can't become a Refund.
    expect(input).not.toHaveProperty('bookingType');
  });

  it('does not render departure/arrival city or date fields for a refund', async () => {
    renderDialog('a2');

    // Wait for the form to load
    await screen.findByLabelText('Adjustment PNR');

    // Assert Reissue-only fields are NOT rendered
    expect(screen.queryByLabelText('Adjustment departure city')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adjustment arrival city')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adjustment departure date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adjustment arrival date')).not.toBeInTheDocument();

    // Assert the refund's fields ARE rendered
    expect(screen.getByDisplayValue('XYZ789')).toBeInTheDocument();
    expect(screen.getByDisplayValue('150')).toBeInTheDocument();
  });

  it('submits a refund without sending departure/arrival city or date fields', async () => {
    const user = userEvent.setup();
    renderDialog('a2');

    const pnr = await screen.findByDisplayValue('XYZ789');
    await user.clear(pnr);
    await user.type(pnr, 'NEW999');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateAdjustment).toHaveBeenCalled());
    const [id, input] = vi.mocked(bookingsApi.updateAdjustment).mock.calls[0];
    expect(id).toBe('a2');
    expect(input.pnr).toBe('NEW999');
    // Refund should never send these fields
    expect(input).not.toHaveProperty('depCity');
    expect(input).not.toHaveProperty('arrCity');
    expect(input).not.toHaveProperty('depDate');
    expect(input).not.toHaveProperty('arrDate');
  });

  it('re-seeds the form when the adjustment ID changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <EditAdjustmentDialog adjustmentId="a1" onOpenChange={() => {}} queryKeyPrefix="bookings" />
      </QueryClientProvider>
    );

    // Wait for the Reissue to load
    await screen.findByDisplayValue('ABC123');
    expect(screen.getByDisplayValue('75')).toBeInTheDocument();
    expect(screen.getByText(/Passenger: SMITH\/JOHN/)).toBeInTheDocument();

    // Re-render with a different adjustment ID
    rerender(
      <QueryClientProvider client={client}>
        <EditAdjustmentDialog adjustmentId="a2" onOpenChange={() => {}} queryKeyPrefix="bookings" />
      </QueryClientProvider>
    );

    // The form should remount (keyed by data.id), so the lazy initializers re-run with the new detail.
    // Wait for the new values to appear in the form
    await screen.findByDisplayValue('XYZ789');
    await screen.findByDisplayValue('150');
    // The passenger name should also change (updated from new detail prop)
    await waitFor(() => expect(screen.getByText(/Passenger: JONES\/JANE/)).toBeInTheDocument());

    // Assert the old Reissue values are no longer in the form
    expect(screen.queryByDisplayValue('ABC123')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('75')).not.toBeInTheDocument();
  });

  // Regression guard for the refetch-mid-edit bug already fixed once in this codebase (see
  // send-quote-dialog.tsx's `wasOpen` ref) and avoided a second time by booking-form.tsx's deleted
  // reset effect. `EditAdjustmentDialog` avoids it by having NO reset-on-`detail`-change effect at
  // all: `AdjustmentEditForm` seeds its state via lazy `useState` initializers and is remounted by
  // `key={data.id}` only when the adjustment id itself changes (see the sibling test above). A
  // background refetch of the SAME id must not disturb that state.
  it('keeps typed input across a background refetch of the same adjustment mid-edit', async () => {
    const user = userEvent.setup();
    const client = renderDialog('a1');

    const pnr = await screen.findByDisplayValue('ABC123');
    await user.clear(pnr);
    await user.type(pnr, 'USERTYPED1');
    expect(pnr).toHaveValue('USERTYPED1');

    // A background refetch returning CHANGED data, which is what forces a new object identity
    // through TanStack Query's structuralSharing (on by default). Without a real change it hands
    // back the previous reference and this guard would be hollow.
    //
    // It changes `passengerName`, which renders straight from the `detail` prop, so the assertion
    // can wait on that DOM signal rather than the mock's call count: the latter resolves before
    // React commits, so asserting immediately after races ahead of the re-render and a reset bug
    // could wipe the form a tick later unseen.
    vi.mocked(bookingsApi.getAdjustment).mockResolvedValue({
      ...REISSUE_DETAIL,
      passengerName: 'CHANGED/PASSENGER',
      pnr: 'SERVERSIDE9',
      amount: 999,
    });
    await client.refetchQueries({ queryKey: ['bookings', 'adjustment', 'a1'] });
    await screen.findByText(/CHANGED\/PASSENGER/);

    // The form must NOT have been re-seeded from the refetched data: the PNR field keeps what the
    // user typed (not the server's 'SERVERSIDE9'), and — the strongest check — the Amount input
    // still shows the ORIGINAL seeded '75', proving the form's own state is independent of the
    // query data even though the passenger line (read directly from the prop, not state) moved on.
    expect(screen.getByDisplayValue('USERTYPED1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('75')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('SERVERSIDE9')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('999')).not.toBeInTheDocument();
  });

  // FIX 1: this form has no "paid on" control of its own (only record-payment-dialog.tsx does),
  // but `PATCH /passengers/:id` replaces `payment` as a whole object — saving ANY unrelated field
  // here (e.g. just retyping the PNR) would silently erase an existing paid-on date otherwise.
  it('preserves an existing payment.paidOn when saving an unrelated field', async () => {
    const user = userEvent.setup();
    vi.mocked(bookingsApi.getAdjustment).mockImplementation((id) => {
      if (id === 'a1') {
        return Promise.resolve({ ...REISSUE_DETAIL, payment: { ...REISSUE_DETAIL.payment, paidOn: '2026-06-15' } });
      }
      return Promise.reject(new Error('Unknown adjustment'));
    });
    renderDialog('a1');

    const pnr = await screen.findByDisplayValue('ABC123');
    await user.clear(pnr);
    await user.type(pnr, 'ZZZ999');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateAdjustment).toHaveBeenCalled());
    const [, input] = vi.mocked(bookingsApi.updateAdjustment).mock.calls[0];
    expect(input.payment.paidOn).toBe('2026-06-15');
  });

  // FIX 1 (second instance): a Refund's form deliberately renders no trip-detail inputs, but an
  // IMPORTED Refund can legitimately have depCity/arrCity/depDate/arrDate stored — the wholesale
  // PATCH must not wipe them just because the user edited some other field (here, the PNR) that
  // has nothing to do with the trip.
  it("carries a stored Refund's trip fields through even though they are never rendered", async () => {
    const user = userEvent.setup();
    vi.mocked(bookingsApi.getAdjustment).mockImplementation((id) => {
      if (id === 'a2') {
        return Promise.resolve({
          ...REFUND_DETAIL,
          depCity: 'DXB',
          arrCity: 'COK',
          depDate: '2026-01-01',
          arrDate: '2026-01-10',
        });
      }
      return Promise.reject(new Error('Unknown adjustment'));
    });
    renderDialog('a2');

    const pnr = await screen.findByDisplayValue('XYZ789');
    await user.clear(pnr);
    await user.type(pnr, 'NEW999');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(bookingsApi.updateAdjustment).toHaveBeenCalled());
    const [, input] = vi.mocked(bookingsApi.updateAdjustment).mock.calls[0];
    expect(input.depCity).toBe('DXB');
    expect(input.arrCity).toBe('COK');
    expect(input.depDate).toBe('2026-01-01');
    expect(input.arrDate).toBe('2026-01-10');
  });

  // FIX 4: this dialog used to render "Save failed. Check your connection and try again." for
  // EVERY backend failure, even a semantic one the user can actually fix.
  it('surfaces a backend guard message instead of a generic connection error', async () => {
    const user = userEvent.setup();
    vi.mocked(bookingsApi.updateAdjustment).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          error: {
            code: 'PAYMENT_AMOUNT_EXCEEDS_TOTAL',
            message: 'This change would drop the invoice total below what is still owed.',
          },
        },
      },
    } as unknown as AxiosError);
    renderDialog('a1');

    await screen.findByDisplayValue('ABC123');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('This change would drop the invoice total below what is still owed.')).toBeInTheDocument();
    expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument();
  });

  // `step` defaults to 1, so without this a $4,275.29 adjustment is a stepMismatch and the browser
  // refuses the form's submit. jsdom does not run interactive constraint validation, so the
  // attribute is all a test here can see — the behaviour it guards is browser-side. Uses the REFUND
  // fixture because it is the pending one, which is what renders Amount owed.
  it('accepts cents on the amount and the amount owed', async () => {
    renderDialog('a2');

    await screen.findByDisplayValue('XYZ789');
    expect(screen.getByLabelText('Adjustment amount')).toHaveAttribute('step', '0.01');
    expect(screen.getByLabelText('Adjustment amount owed')).toHaveAttribute('step', '0.01');
  });
});
