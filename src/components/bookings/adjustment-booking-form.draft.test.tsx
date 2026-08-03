import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdjustmentBookingForm, AdjustmentDraftState } from './adjustment-booking-form';
import * as bookingsApi from '@/api/bookings.api';
import { useAuthStore } from '@/stores/authStore';
import { clearDraft, readDraft, StoredDraft, writeDraft } from '@/utils/formDraft';
import { FUTURE_ARR_DATE, FUTURE_DEP_DATE } from '@/test-utils/dates';

// Finding 6: import the REAL draft-state type from the component rather than hand-mirroring it —
// a hand-copied `TestDraftState` interface is the same duplication class Finding 3 removed from
// the source (`AdjustmentShared`/`AdjustmentSharedValue`): the two shapes can silently drift, and
// nothing would catch it until a real restore broke in a way no test could reproduce.
function writeTestDraft(userId: string, key: 'booking:reissue' | 'booking:refund', state: AdjustmentDraftState): void {
  writeDraft<AdjustmentDraftState>(userId, key, state);
}

function readTestDraft(
  userId: string,
  key: 'booking:reissue' | 'booking:refund'
): StoredDraft<AdjustmentDraftState> | null {
  return readDraft<AdjustmentDraftState>(userId, key);
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function mockSearch(rows: bookingsApi.BookingRow[] = []) {
  return vi.spyOn(bookingsApi, 'listBookings').mockResolvedValue({
    bookings: rows,
    total: rows.length,
    page: 1,
    pageSize: 50,
  });
}

const USER = { id: 'u1', name: 'Agent', email: 'a@example.com', role: 'superadmin' as const };

const PAX_A: bookingsApi.BookingRow = {
  id: 'p1',
  invoiceNumber: '0000150',
  bookingDate: '2026-05-04',
  passengerName: 'JOSEPH/SHINY S',
  amount: 50,
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

const PAX_B: bookingsApi.BookingRow = { ...PAX_A, id: 'p2', passengerName: 'JOSEPH/ANTON', amount: 75 };

/** A realistic `shared` fixture — every field populated, not `{}` — so a restore test that reads
 * one of these back actually proves the round-trip, per Finding 4. */
// depDate/arrDate MUST be computed relative to "now", not hardcoded — a Reissue's Departure/Arrival
// Date floors at the agency's today (see booking-form.tsx's/adjustment-booking-form.tsx's
// `minTripDate`), so a fixed literal rots the instant it slips into the past: the hidden native
// date input's `min` constraint then silently blocks the form's native submit with NO required
// attribute involved (a plain rangeUnderflow), which shows up as "createAdjustment was never
// called" with no hint that a stale date is the cause. See src/test-utils/dates.ts.
const SHARED_FIXTURE: AdjustmentDraftState['shared'] = {
  bookingDate: '2026-06-01',
  pnr: 'WXITNF',
  airlineCode: 'QR',
  depCity: 'DXB',
  arrCity: 'COK',
  depDate: FUTURE_DEP_DATE,
  arrDate: FUTURE_ARR_DATE,
  remark: 'Rebooked after schedule change',
  paymentStatus: 'pending',
  paymentType: 'check',
  pendingAmount: '40',
};

const GROUP = {
  pnr: 'ABC123',
  invoiceNumber: 'INV-500',
  passengers: [PAX_A, PAX_B],
};

function renderForm(bookingType: 'Reissue' | 'Refund' = 'Reissue', onCancel = vi.fn(), onDone = vi.fn()) {
  mockSearch();
  renderWithClient(<AdjustmentBookingForm bookingType={bookingType} onDone={onDone} onCancel={onCancel} />);
  return { onCancel, onDone };
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ accessToken: 't', user: USER });
});

describe('AdjustmentBookingForm drafts', () => {
  it('keys Reissue and Refund separately', () => {
    writeTestDraft('u1', 'booking:refund', {
      pnrQuery: 'REFUNDQ',
      selectedGroup: GROUP,
      checked: {},
      amounts: {},
      shared: SHARED_FIXTURE,
      succeeded: [],
    });

    renderForm('Reissue');
    expect(screen.queryByText(/unfinished draft/i)).not.toBeInTheDocument();
  });

  it('offers a Refund draft to the Refund form', () => {
    writeTestDraft('u1', 'booking:refund', {
      pnrQuery: 'REFUNDQ',
      selectedGroup: GROUP,
      checked: {},
      amounts: {},
      shared: SHARED_FIXTURE,
      succeeded: [],
    });

    renderForm('Refund');
    expect(screen.getByText(/unfinished draft/i)).toBeInTheDocument();
  });

  it('ROUND-TRIPS `succeeded`, `shared`, and the passenger group so a restored retry cannot double-post', async () => {
    writeTestDraft('u1', 'booking:reissue', {
      pnrQuery: 'GUDBFX',
      selectedGroup: GROUP,
      checked: { p1: true, p2: true },
      amounts: { p1: '50', p2: '75' },
      shared: SHARED_FIXTURE,
      succeeded: ['p1'],
    });

    renderForm('Reissue');
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    // CRITICAL: clear the draft the test itself pre-seeded immediately after clicking Restore.
    // Without this, the assertions below would trivially pass by reading back the untouched,
    // never-cleared PRE-restore draft — proving nothing about whether handleRestoreDraft actually
    // put anything into React state. Clearing it here forces the only way a draft can reappear to
    // be the form's own autosave effect re-writing from LIVE (post-restore) component state, which
    // is the thing this test exists to verify.
    clearDraft('u1', 'booking:reissue');
    expect(readTestDraft('u1', 'booking:reissue')).toBeNull();

    // The restored form must still know p1 already landed, AND must have actually restored the
    // shared trip/payment fields and the passenger group/amounts — not just re-typed the PNR.
    // Asserting on multiple, REALISTIC (non-empty) fields is what makes this a genuine round-trip
    // test rather than a hollow one (Finding 4).
    await waitFor(
      () => {
        const stored = readTestDraft('u1', 'booking:reissue');
        expect(stored).not.toBeNull();
        expect(stored?.state.pnrQuery).toBe('GUDBFX');
        expect(stored?.state.checked).toEqual({ p1: true, p2: true });
        expect(stored?.state.amounts).toEqual({ p1: '50', p2: '75' });
        expect(stored?.state.selectedGroup?.passengers).toHaveLength(2);
        expect(stored?.state.shared).toEqual(SHARED_FIXTURE);
        expect(stored?.state.succeeded).toEqual(['p1']);
      },
      { timeout: 2000 }
    );

    // The restored values are also genuinely on screen, not just sitting in a variable nobody reads.
    expect(screen.getByLabelText('Adjustment PNR')).toHaveValue('WXITNF');
    expect(screen.getByLabelText('Adjustment remark')).toHaveValue('Rebooked after schedule change');
  });

  it('does not draft before a PNR is picked', async () => {
    renderForm('Reissue');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(readTestDraft('u1', 'booking:reissue')).toBeNull();
  });

  it('FINDING 1: flushes `succeeded` to the draft after EACH success, not once after the whole submit — abandoning mid-flight cannot double-post', async () => {
    mockSearch([PAX_A, PAX_B]);
    const create = vi.spyOn(bookingsApi, 'createAdjustment').mockImplementation((passengerId: string) => {
      if (passengerId === 'p1') {
        return Promise.resolve({ id: 'adj1', bookingType: 'Reissue' as const, parentRef: 'p1', amount: 50 });
      }
      // p2 never resolves in this test — simulates the user abandoning the submit mid-flight
      // (Cancel, or Escape, which bypasses handleCancelClick entirely) before the loop finishes.
      return new Promise<never>(() => {});
    });

    renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Original PNR'), 'GUD');
    await userEvent.click(await screen.findByRole('button', { name: /GUDBFX — 0000150 — 2 passengers/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Record reissue' }));

    // Both createAdjustment calls have been ISSUED (p2's promise never settles) — the submit loop
    // is genuinely still in flight at this point.
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2), { timeout: 2000 });

    // p1 already posted. The draft must reflect that BEFORE p2 (which never resolves) settles and
    // before the whole submit "finishes" — proving `succeeded` is flushed to React state, and then
    // to storage by the autosave effect, per passenger, not once at the end of the loop.
    await waitFor(
      () => {
        const stored = readTestDraft('u1', 'booking:reissue');
        expect(stored?.state.succeeded).toEqual(['p1']);
      },
      { timeout: 2000 }
    );
  });

  it('FINDING 7: UNIONS live `succeeded` with the stored draft on Restore — a same-session partial submit survives clicking the (non-blocking) restore bar', async () => {
    // An OLDER session's draft, with `succeeded` EMPTY — this is what Restore will hand back.
    writeTestDraft('u1', 'booking:reissue', {
      pnrQuery: 'GUDBFX',
      selectedGroup: GROUP,
      checked: { p1: true, p2: true },
      amounts: { p1: '50', p2: '75' },
      shared: SHARED_FIXTURE,
      succeeded: [],
    });

    mockSearch([PAX_A, PAX_B]);
    const create = vi.spyOn(bookingsApi, 'createAdjustment').mockImplementation((passengerId: string) =>
      passengerId === 'p1'
        ? Promise.resolve({ id: 'adj1', bookingType: 'Reissue', parentRef: 'p1', amount: 50 })
        : Promise.reject(new Error('boom'))
    );

    renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={vi.fn()} onCancel={vi.fn()} />);

    // The restore bar is showing (`draft.pending` is non-null) but is NON-BLOCKING — the user
    // ignores it, searches and picks the PNR, and submits in THIS session before ever clicking
    // Restore, exactly the reachable path the review flagged.
    expect(screen.getByText(/unfinished draft/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Original PNR'), 'GUD');
    await userEvent.click(await screen.findByRole('button', { name: /GUDBFX — 0000150 — 2 passengers/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Record reissue' }));

    // A genuine PARTIAL submit: p1 posts, p2 fails. Live `succeeded` now holds p1 (this session's
    // fact), while the stored draft still says `succeeded: []` (the older session's fact).
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(await screen.findByText(/Failed for: JOSEPH\/ANTON/)).toBeInTheDocument();

    // Only NOW does the user click Restore on the still-showing bar.
    create.mockClear();
    create.mockResolvedValue({ id: 'adj2', bookingType: 'Reissue', parentRef: 'p2', amount: 75 });
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await userEvent.click(screen.getByRole('button', { name: 'Retry failed' }));

    // p1 must NOT be re-posted. A REPLACE (rather than a UNION) of `succeeded` on restore would
    // have forgotten p1 already landed and resubmitted BOTH passengers here — a real ledger
    // double-post, since adjustments have no duplicate detection at the API to catch it.
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(create).toHaveBeenCalledWith('p2', expect.anything());
  });

  it('FINDING 5: TIMING PROBE — succeeded is written SYNCHRONOUSLY (flush), not only after 500ms of quiescence, for a fast multi-passenger submit', async () => {
    // Three passengers so there is a THIRD, still-in-flight call to observe once the first two have
    // genuinely posted — the exact shape the reviewer's manual measurement used (3 passengers,
    // ~150ms each). Two passengers isn't enough to distinguish "flushed synchronously" from
    // "eventually caught up by the 500ms debounce once the (never-settling) loop went quiet",
    // because with only one prior success there's nothing after it to keep restarting the timer.
    const PAX_C: bookingsApi.BookingRow = { ...PAX_A, id: 'p3', passengerName: 'JOSEPH/MARY' };
    mockSearch([PAX_A, PAX_B, PAX_C]);

    function delayed<T>(value: T, ms: number): Promise<T> {
      return new Promise((resolve) => setTimeout(() => resolve(value), ms));
    }

    const create = vi.spyOn(bookingsApi, 'createAdjustment').mockImplementation((passengerId: string) => {
      if (passengerId === 'p1') {
        return delayed({ id: 'adj1', bookingType: 'Reissue', parentRef: 'p1', amount: 50 }, 150);
      }
      if (passengerId === 'p2') {
        return delayed({ id: 'adj2', bookingType: 'Reissue', parentRef: 'p2', amount: 75 }, 150);
      }
      // p3 never resolves — the user abandons (Escape) the instant it goes out, which is the
      // precise moment this test inspects storage.
      return new Promise<never>(() => {});
    });

    renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Original PNR'), 'GUD');
    await userEvent.click(await screen.findByRole('button', { name: /GUDBFX — 0000150 — 3 passengers/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Record reissue' }));

    // Wait only until p3's call has been ISSUED (p1 and p2 have each taken their real ~150ms and
    // resolved) — NOT for anything further to settle. Total elapsed here is ~300ms: comfortably
    // under the 500ms autosave debounce, so nothing about ordinary quiescence-based writing could
    // have fired yet.
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3), { timeout: 2000 });

    // Checked in the SAME tick p3's call was observed — no further `waitFor`/sleep. Under the
    // debounce-only (pre-Finding-5) implementation this reads `succeeded: []` (or the draft may not
    // exist yet at all); only a synchronous `flush()` after each success can make this true this
    // soon, before 500ms of quiescence has had any chance to elapse.
    expect(readTestDraft('u1', 'booking:reissue')?.state.succeeded).toEqual(['p1', 'p2']);
  });

  it('FINDING 2: clears the stored draft once every checked passenger has succeeded', async () => {
    mockSearch([PAX_A, PAX_B]);
    vi.spyOn(bookingsApi, 'createAdjustment').mockResolvedValue({
      id: 'adj1',
      bookingType: 'Reissue',
      parentRef: 'p1',
      amount: 50,
    });
    const onDone = vi.fn();

    renderWithClient(<AdjustmentBookingForm bookingType="Reissue" onDone={onDone} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Original PNR'), 'GUD');
    await userEvent.click(await screen.findByRole('button', { name: /GUDBFX — 0000150 — 2 passengers/ }));

    // Let the autosave effect write a pre-submit draft first, so this test actually proves the
    // draft is CLEARED by a successful submit rather than merely proving one was never written.
    await waitFor(() => expect(readTestDraft('u1', 'booking:reissue')).not.toBeNull(), { timeout: 2000 });

    await userEvent.click(screen.getByRole('button', { name: 'Record reissue' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 2000 });
    expect(readTestDraft('u1', 'booking:reissue')).toBeNull();
  });
});
