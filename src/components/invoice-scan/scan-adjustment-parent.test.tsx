import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScanAdjustmentParent from './scan-adjustment-parent';
import { ReviewInvoice } from './reviewInvoice';
import * as bookings from '@/api/bookings.api';

vi.mock('@/api/bookings.api');

const ADJUSTMENT: ReviewInvoice = {
  id: 'scan-0', status: 'attention', pageStart: 1, pageEnd: 1, type: 'Reissue',
  invoiceNumber: null, bookingDate: '2026-08-01', pnr: 'MHNGLM',
  passengers: [{ name: 'JACOB/SHIBIN THOMAS', child: false, amount: null, ticketNumber: null, confidence: 96 }],
  segments: [], airlineName: 'ETIHAD AIRWAYS',
  depCityText: 'ATLANTA', arrCityText: 'KOCHI',
  depDate: '2026-11-05', arrDateReturn: '2026-11-26', arrDateFinal: '2026-11-26',
  netCcBilling: null, issues: [],
  airlineCode: 'EY', depCity: 'ATL', arrCity: 'COK',
  remark: null,
  arrDateChoice: 'return', customerIds: ['c1'], parentPassengerIds: [null], adjustmentIds: [null],
  originalPnr: 'MHNGLM',
  adjustmentAmounts: [null],
};

const ROW: bookings.BookingRow = {
  id: 'p1', bookingDate: '2026-07-31', invoiceNumber: '0000249',
  passengerName: 'Jacob/Shibin Thomas', amount: 4275.29, pnr: 'MHNGLM', bookingType: 'New',
};

beforeEach(() => {
  vi.mocked(bookings.listBookings).mockReset();
});

// This component uses `useQuery` (matching the codebase's established convention for a
// search-backed lookup — see `code-search-field.tsx`/`adjustment-booking-form.tsx`), so every
// render needs an ancestor `QueryClientProvider`, per the app-wide rule: "never put a
// QueryClientProvider inside a component — wrap the test's render() instead."
function renderComponent(invoice: ReviewInvoice, onChange: (next: ReviewInvoice) => void) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScanAdjustmentParent invoice={invoice} onChange={onChange} />
    </QueryClientProvider>
  );
}

/** Feeds `ScanAdjustmentParent`'s `onChange` output back in as its own `invoice` prop — needed for
 * the cross-row-dedupe test below, which must observe how a pick made through ONE row's `Select`
 * affects what a DIFFERENT row's `Select` subsequently offers. The plain `renderComponent` above
 * is a fully static prop (no feedback loop), which is fine for every other test here since none of
 * them depend on the component re-rendering off its own onChange output — but it would silently
 * hide this component's central invariant if reused for the dedupe case. */
function renderControlled(initial: ReviewInvoice) {
  function Harness() {
    const [invoice, setInvoice] = useState(initial);
    return <ScanAdjustmentParent invoice={invoice} onChange={setInvoice} />;
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>
  );
}

describe('ScanAdjustmentParent', () => {
  it('searches for the original booking by the scanned PNR', async () => {
    vi.mocked(bookings.listBookings).mockResolvedValue({ bookings: [ROW], total: 1, page: 1, pageSize: 50 });
    renderComponent(ADJUSTMENT, vi.fn());

    await waitFor(() =>
      expect(bookings.listBookings).toHaveBeenCalledWith(expect.objectContaining({ q: 'MHNGLM' }))
    );
  });

  it('pre-selects the original when exactly one passenger matches the scanned name', async () => {
    vi.mocked(bookings.listBookings).mockResolvedValue({ bookings: [ROW], total: 1, page: 1, pageSize: 50 });
    const onChange = vi.fn();
    renderComponent(ADJUSTMENT, onChange);

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: ['p1'] }))
    );
  });

  // Final review, I6: the auto-select's NAME check had no test at all — deleting
  // `only.passengerName === passenger.name` from the effect left all 85 scan tests green, because
  // every fixture's single candidate happened to name-match the scanned passenger. Without the
  // check, ANY lone exact-PNR New row is silently wired up as the parent, so a reissue scanned for
  // one traveller attaches to a different traveller who merely shares the PNR — money landing on
  // the wrong person's ledger, which is the exact failure this component's design exists to avoid.
  it('does not auto-select a lone candidate whose name does not match the scanned passenger', async () => {
    vi.mocked(bookings.listBookings).mockResolvedValue({
      // Same exact PNR, same New type — the ONLY thing wrong with it is the name.
      bookings: [{ ...ROW, id: 'p7', passengerName: 'Different/Person Entirely' }],
      total: 1, page: 1, pageSize: 50,
    });
    const onChange = vi.fn();
    renderComponent(ADJUSTMENT, onChange);

    // The manual picker must be offered instead — and the candidate is still listed there, since
    // an OCR'd name can legitimately be unrecognisable; it just may not be chosen for the operator.
    expect(await screen.findByText(/choose the original passenger/i)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('asks the operator to choose when several passengers share the PNR', async () => {
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [ROW, { ...ROW, id: 'p2', passengerName: 'Babu/Athira' }],
      total: 2, page: 1, pageSize: 50,
    });
    renderComponent(ADJUSTMENT, vi.fn());

    expect(await screen.findByText(/choose the original passenger/i)).toBeInTheDocument();
  });

  it('offers only New rows as a parent, since an adjustment cannot adjust an adjustment', async () => {
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [{ ...ROW, id: 'p3', bookingType: 'Reissue' }],
      total: 1, page: 1, pageSize: 50,
    });
    renderComponent(ADJUSTMENT, vi.fn());

    expect(await screen.findByText(/no original booking found/i)).toBeInTheDocument();
  });

  // The backend's `q` search is an unanchored SUBSTRING match on
  // passenger name OR PNR (bookingQuery.service.ts) — a row can come back because its PNR merely
  // *contains* the queried text, or because its NAME matched, with a completely unrelated PNR.
  // Every ROW fixture above happens to carry the exact same PNR as the scanned invoice, which is
  // exactly why this was invisible until now.
  it('excludes a candidate row whose PNR does not exactly match the scanned PNR, even though the substring search returned it', async () => {
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [{ ...ROW, id: 'p9', pnr: 'ZZZZZZ' }],
      total: 1, page: 1, pageSize: 50,
    });
    renderComponent(ADJUSTMENT, vi.fn());

    expect(await screen.findByText(/no original booking found/i)).toBeInTheDocument();
  });

  it('auto-selects only the exact-PNR candidate when the search also returns a same-name, different-PNR row', async () => {
    const onChange = vi.fn();
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [ROW, { ...ROW, id: 'p9', pnr: 'ZZZZZZ' }],
      total: 2, page: 1, pageSize: 50,
    });
    renderComponent(ADJUSTMENT, onChange);

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: ['p1'] }))
    );
  });

  it('never offers a wrong-PNR row as a candidate in the manual picker, even when returned by the substring search', async () => {
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [
        ROW,
        { ...ROW, id: 'p2', passengerName: 'Babu/Athira' }, // same exact PNR — forces the manual chooser
        { ...ROW, id: 'p9', pnr: 'ZZZZZZ', passengerName: 'Wrongpnr/Person' }, // different PNR
      ],
      total: 3, page: 1, pageSize: 50,
    });
    renderComponent(ADJUSTMENT, vi.fn());

    await userEvent.click(await screen.findByRole('combobox', { name: /original passenger for jacob\/shibin thomas/i }));
    expect(await screen.findByRole('option', { name: /jacob\/shibin thomas/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /wrongpnr/i })).not.toBeInTheDocument();
  });

  // Nothing should let the SAME original passenger be picked for two
  // different scanned rows, manually any more than automatically.
  it("excludes an original passenger already picked for another row from a second row's picker", async () => {
    const TWO_PAX_ADJUSTMENT: ReviewInvoice = {
      ...ADJUSTMENT,
      passengers: [
        { name: 'JACOB/SHIBIN THOMAS', child: false, amount: null, ticketNumber: null, confidence: 96 },
        { name: 'BABU/ATHIRA', child: false, amount: null, ticketNumber: null, confidence: 96 },
      ],
      customerIds: ['c1', 'c2'],
      parentPassengerIds: [null, null],
      adjustmentIds: [null, null],
      adjustmentAmounts: [null, null],
    };
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [ROW, { ...ROW, id: 'p2', passengerName: 'Babu/Athira' }],
      total: 2, page: 1, pageSize: 50,
    });
    renderControlled(TWO_PAX_ADJUSTMENT);

    // Manually assign p1 to the first row.
    await userEvent.click(await screen.findByRole('combobox', { name: /original passenger for jacob\/shibin thomas/i }));
    await userEvent.click(await screen.findByRole('option', { name: /jacob\/shibin thomas/i }));

    // The second row's own picker must no longer offer p1 — the Harness feeds `onChange` back
    // into state, so this proves the exclusion is recomputed from the UPDATED
    // `invoice.parentPassengerIds` on the very next render, not just true at mount.
    await userEvent.click(await screen.findByRole('combobox', { name: /original passenger for babu\/athira/i }));
    expect(screen.queryByRole('option', { name: /jacob\/shibin thomas/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /babu\/athira/i })).toBeInTheDocument();
  });

  // The auto-select dedupe (`claimed` tracking in the effect) had zero
  // direct coverage — no test ever had TWO scanned passengers with the identical OCR'd name
  // against a single candidate row. The manual `takenElsewhere` half was well pinned by the test
  // above; this proves the AUTO-select half of the same invariant independently.
  it('lets only the first of two identically-OCRd scanned passengers auto-claim the single matching candidate', async () => {
    const DUPLICATE_NAME_ADJUSTMENT: ReviewInvoice = {
      ...ADJUSTMENT,
      passengers: [
        { name: 'JACOB/SHIBIN THOMAS', child: false, amount: null, ticketNumber: null, confidence: 96 },
        { name: 'JACOB/SHIBIN THOMAS', child: false, amount: null, ticketNumber: null, confidence: 96 },
      ],
      customerIds: ['c1', 'c2'],
      parentPassengerIds: [null, null],
      adjustmentIds: [null, null],
      adjustmentAmounts: [null, null],
    };
    vi.mocked(bookings.listBookings).mockResolvedValue({ bookings: [ROW], total: 1, page: 1, pageSize: 50 });
    const onChange = vi.fn();
    renderComponent(DUPLICATE_NAME_ADJUSTMENT, onChange);

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: ['p1', null] }))
    );
    // The bug this guards against: assigning the lone candidate to EVERY name-matching index
    // instead of just the first would have produced ['p1', 'p1'] here.
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: ['p1', 'p1'] }));
  });

  // The original design collapsed to a read-only summary the instant
  // every row resolved, with no way back short of re-uploading the whole PDF — a real problem
  // since this feature's entire premise is reviewing and CORRECTING OCR/matching output. A
  // misclick here silently attaches a reissue/refund to the wrong person's ledger permanently.
  it('lets the operator correct a misclicked pick via a per-row Change button', async () => {
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [ROW, { ...ROW, id: 'p2', passengerName: 'Babu/Athira' }],
      total: 2, page: 1, pageSize: 50,
    });
    renderControlled(ADJUSTMENT);

    // Operator misclicks and picks the WRONG original (Babu/Athira) for the scanned Jacob/Shibin
    // Thomas passenger.
    await userEvent.click(await screen.findByRole('combobox', { name: /original passenger for jacob\/shibin thomas/i }));
    await userEvent.click(await screen.findByRole('option', { name: /babu\/athira/i }));

    // The row is now resolved (to the WRONG original) and offers a Change button instead of a
    // picker — no Select left to reopen directly.
    expect(await screen.findByText(/mhnglm — babu\/athira — 0000249/i)).toBeInTheDocument();
    const changeButton = screen.getByRole('button', { name: /change original passenger for jacob\/shibin thomas/i });

    await userEvent.click(changeButton);

    // The picker is back, and BOTH candidates are offered again — there is no OTHER row in this
    // single-passenger fixture, so clearing this row's own pick must not still exclude it.
    await userEvent.click(await screen.findByRole('combobox', { name: /original passenger for jacob\/shibin thomas/i }));
    expect(await screen.findByRole('option', { name: /jacob\/shibin thomas/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /babu\/athira/i })).toBeInTheDocument();

    // Pick the CORRECT original this time.
    await userEvent.click(screen.getByRole('option', { name: /jacob\/shibin thomas/i }));

    expect(await screen.findByText(/mhnglm — jacob\/shibin thomas — 0000249/i)).toBeInTheDocument();
  });

  // Make sure claimed/takenElsewhere
  // still hold once it can [be changed]". Proves reopening ONE row via Change can never let it
  // steal an id a DIFFERENT row still holds — the dedupe invariant must survive a correction.
  it('still excludes an id another row already holds after a Change reopens a different row', async () => {
    const TWO_PAX_ADJUSTMENT: ReviewInvoice = {
      ...ADJUSTMENT,
      passengers: [
        { name: 'JACOB/SHIBIN THOMAS', child: false, amount: null, ticketNumber: null, confidence: 96 },
        { name: 'BABU/ATHIRA', child: false, amount: null, ticketNumber: null, confidence: 96 },
      ],
      customerIds: ['c1', 'c2'],
      parentPassengerIds: [null, null],
      adjustmentIds: [null, null],
      adjustmentAmounts: [null, null],
    };
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [ROW, { ...ROW, id: 'p2', passengerName: 'Babu/Athira' }],
      total: 2, page: 1, pageSize: 50,
    });
    renderControlled(TWO_PAX_ADJUSTMENT);

    // Resolve both rows to their correct originals first.
    await userEvent.click(await screen.findByRole('combobox', { name: /original passenger for jacob\/shibin thomas/i }));
    await userEvent.click(await screen.findByRole('option', { name: /jacob\/shibin thomas/i }));
    await userEvent.click(await screen.findByRole('combobox', { name: /original passenger for babu\/athira/i }));
    await userEvent.click(await screen.findByRole('option', { name: /babu\/athira/i }));

    // Reopen row 0 via Change — row 1 (Babu/Athira) still holds p2.
    await userEvent.click(screen.getByRole('button', { name: /change original passenger for jacob\/shibin thomas/i }));

    await userEvent.click(await screen.findByRole('combobox', { name: /original passenger for jacob\/shibin thomas/i }));
    expect(screen.queryByRole('option', { name: /babu\/athira/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /jacob\/shibin thomas/i })).toBeInTheDocument();
  });

  // The Important finding: nothing cleared a resolved `parentPassengerIds` slot when
  // `invoice.pnr` itself was edited (the real edit path is the PNR field in scan-invoice-detail.tsx;
  // this Harness drives the SAME prop change through the SAME onChange round trip, never hand-fed
  // parentPassengerIds directly — a hand-fed test would miss exactly the wiring at issue).
  describe('PNR correction after a parent is already resolved', () => {
    /** Mirrors `renderControlled` but adds a button that edits `invoice.pnr` — standing in for the
     * real PNR `IconInput` in `scan-invoice-detail.tsx`, which is a sibling component this test
     * doesn't need to mount to exercise the same prop-level change. */
    function renderWithPnrEditor(initial: ReviewInvoice, nextPnr: string, onChange: (next: ReviewInvoice) => void) {
      function Harness() {
        const [invoice, setInvoice] = useState(initial);
        return (
          <>
            <button
              type="button"
              onClick={() =>
                setInvoice((inv) => ({
                  ...inv,
                  pnr: nextPnr,
                  originalPnr: inv.originalPnr === inv.pnr ? nextPnr : inv.originalPnr,
                }))
              }
            >
              Correct PNR
            </button>
            <ScanAdjustmentParent
              invoice={invoice}
              onChange={(next) => {
                setInvoice(next);
                onChange(next);
              }}
            />
          </>
        );
      }
      return render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Harness />
        </QueryClientProvider>
      );
    }

    it('clears a resolved parent and shows "no original booking found" once the corrected PNR settles with no match', async () => {
      vi.mocked(bookings.listBookings).mockImplementation(async (params) => {
        if (params?.q === 'MHNGLM') return { bookings: [ROW], total: 1, page: 1, pageSize: 50 };
        return { bookings: [], total: 0, page: 1, pageSize: 50 };
      });
      const onChange = vi.fn();
      renderWithPnrEditor(ADJUSTMENT, 'MHNGLN', onChange);

      // Auto-resolves against the original (correct-at-scan-time) PNR.
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: ['p1'] }))
      );

      await userEvent.click(screen.getByRole('button', { name: /correct pnr/i }));

      // The stale id must be cleared once the new PNR's search genuinely settles — not left
      // dangling just because the panel now (correctly) says nothing matches.
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: [null] }))
      );
      expect(await screen.findByText(/no original booking found/i)).toBeInTheDocument();
    });

    // An earlier fix only handled the "settled with a confirmed no-match" path. A
    // corrected PNR whose lookup ERRORS TERMINALLY (production's QueryClient retries 3 times, so
    // ~7s then a hard failure with nothing cached) left `data === undefined`, the effect
    // early-returned, and the stale parent id survived — `statusFor` still saw a resolved parent,
    // Save stayed enabled, and it would have POSTed the reissue against a passenger on the OLD PNR.
    // Exactly the wrong-parent write this guards against, reached through the error path.
    it('clears a resolved parent when the corrected PNR lookup fails terminally with nothing cached', async () => {
      vi.mocked(bookings.listBookings).mockImplementation(async (params) => {
        if (params?.q === 'MHNGLM') return { bookings: [ROW], total: 1, page: 1, pageSize: 50 };
        throw new Error('network down');
      });
      const onChange = vi.fn();
      renderWithPnrEditor(ADJUSTMENT, 'MHNGLN', onChange);

      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: ['p1'] }))
      );

      await userEvent.click(screen.getByRole('button', { name: /correct pnr/i }));

      await waitFor(() => {
        const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as ReviewInvoice;
        expect(lastCall.parentPassengerIds).toEqual([null]);
      });
    });

    // The other half of the same fix: the panel used to render `null` on a terminal error, which is
    // byte-for-byte what it renders while LOADING — so the operator had no signal at all that the
    // lookup had failed rather than simply not finished.
    it('renders a lookup-failed message instead of nothing when the PNR search errors with nothing cached', async () => {
      vi.mocked(bookings.listBookings).mockRejectedValue(new Error('network down'));
      renderComponent(ADJUSTMENT, vi.fn());

      expect(await screen.findByText(/could not look up the original booking/i)).toBeInTheDocument();
    });

    // The narrow, deliberate exception the fix must NOT break: once a PNR's query has succeeded,
    // TanStack RETAINS that data through a later failed refetch. `isError` alone is therefore not
    // enough to clear on — a transient blip on the SAME PNR must leave a valid pick (and the
    // resolved summary) exactly where they are. Only "errored AND never successfully fetched for
    // this PNR" (`data === undefined`) is a real loss of knowledge.
    it('keeps a valid pick when a refetch for the same PNR errors while its data is still cached', async () => {
      vi.mocked(bookings.listBookings).mockResolvedValue({ bookings: [ROW], total: 1, page: 1, pageSize: 50 });
      const onChange = vi.fn();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      function Harness() {
        const [invoice, setInvoice] = useState(ADJUSTMENT);
        return (
          <ScanAdjustmentParent
            invoice={invoice}
            onChange={(next) => {
              setInvoice(next);
              onChange(next);
            }}
          />
        );
      }
      render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>
      );

      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: ['p1'] }))
      );
      expect(await screen.findByText(/original passenger resolved/i)).toBeInTheDocument();

      // Same PNR, same query key — the refetch fails but the last good data is retained.
      vi.mocked(bookings.listBookings).mockRejectedValue(new Error('blip'));
      await client.refetchQueries({ queryKey: ['bookings', 'adjustment-parent', 'MHNGLM'] });

      // Nothing was wiped: still resolved, and no clearing onChange was ever emitted.
      expect(await screen.findByText(/original passenger resolved/i)).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: [null] }));
      expect(screen.queryByText(/could not look up the original booking/i)).not.toBeInTheDocument();
    });

    it('clears the stale parent AND re-auto-selects in the same settle when the corrected PNR resolves to exactly one new candidate', async () => {
      vi.mocked(bookings.listBookings).mockImplementation(async (params) => {
        if (params?.q === 'MHNGLM') return { bookings: [ROW], total: 1, page: 1, pageSize: 50 };
        if (params?.q === 'MHNGLN') {
          return { bookings: [{ ...ROW, id: 'p9', pnr: 'MHNGLN' }], total: 1, page: 1, pageSize: 50 };
        }
        return { bookings: [], total: 0, page: 1, pageSize: 50 };
      });
      const onChange = vi.fn();
      renderWithPnrEditor(ADJUSTMENT, 'MHNGLN', onChange);

      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ parentPassengerIds: ['p1'] }))
      );

      await userEvent.click(screen.getByRole('button', { name: /correct pnr/i }));

      // Never left dangling on the stale 'p1', and never requires a second manual pick for an
      // unambiguous correction — proves the auto-select half doesn't need (and isn't blocked by)
      // a second `[rows, data]` change that would never actually arrive. (onChange legitimately
      // WAS called with 'p1' earlier, against the original PNR — the assertion is on the FINAL,
      // settled state, not that 'p1' was never seen at all.)
      await waitFor(() => {
        const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as ReviewInvoice;
        expect(lastCall.parentPassengerIds).toEqual(['p9']);
      });
    });
  });
});

/** A New row on a DIFFERENT PNR from the scan's, carrying full trip details to prefill from. */
const OTHER_PNR_ROW: bookings.BookingRow = {
  id: 'p9', bookingDate: '2026-06-01', invoiceNumber: '0000255',
  passengerName: 'Jacob/Shibin Thomas', amount: 1800.29, pnr: 'CNRAPN', bookingType: 'New',
  airlineCode: 'QR', depCity: 'IAH', arrCity: 'COK',
  depDate: '2026-01-16', arrDate: '2026-02-07',
};

/** Controlled like `renderControlled`, but also records every `onChange` payload — needed by the
 * prefill test, which asserts on the object the component hands back, not just what it renders. */
function renderControlledSpy(initial: ReviewInvoice) {
  const seen: ReviewInvoice[] = [];
  function Harness() {
    const [invoice, setInvoice] = useState(initial);
    return (
      <ScanAdjustmentParent
        invoice={invoice}
        onChange={(next) => {
          seen.push(next);
          setInvoice(next);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>
  );
  return seen;
}

describe('ScanAdjustmentParent — searchable original PNR', () => {
  /** Only `CNRAPN` exists in the ledger; the scan's misread `CNRAPM` finds nothing, and a partial
   *  prefix finds it the way the backend's substring `q` search would. */
  function onlyCnrapn() {
    vi.mocked(bookings.listBookings).mockImplementation(async (params) => {
      const query = (params?.q ?? '').toUpperCase();
      return query.length >= 3 && 'CNRAPN'.startsWith(query)
        ? { bookings: [OTHER_PNR_ROW], total: 1, page: 1, pageSize: 50 }
        : { bookings: [], total: 0, page: 1, pageSize: 50 };
    });
  }

  it('seeds the Original PNR search from the scanned PNR', async () => {
    vi.mocked(bookings.listBookings).mockResolvedValue({ bookings: [ROW], total: 1, page: 1, pageSize: 50 });
    renderComponent(ADJUSTMENT, vi.fn());

    expect(await screen.findByLabelText(/original pnr/i)).toHaveValue('MHNGLM');
  });

  it('resolves the original once the operator types the correct PNR in full', async () => {
    onlyCnrapn();
    renderControlledSpy({ ...ADJUSTMENT, pnr: 'CNRAPM', originalPnr: 'CNRAPM' });

    const search = await screen.findByLabelText(/original pnr/i);
    await userEvent.clear(search);
    await userEvent.type(search, 'CNRAPN');

    expect(
      await screen.findByText(/original passenger resolved/i, undefined, { timeout: 3000 })
    ).toBeInTheDocument();
  });

  it('offers the bookings it finds when the typed PNR is only partial', async () => {
    onlyCnrapn();
    renderControlledSpy({ ...ADJUSTMENT, pnr: 'CNRAPM', originalPnr: 'CNRAPM' });

    const search = await screen.findByLabelText(/original pnr/i);
    await userEvent.clear(search);
    await userEvent.type(search, 'CNRAP');

    expect(
      await screen.findByRole('button', { name: /CNRAPN.*0000255/i }, { timeout: 3000 })
    ).toBeInTheDocument();
  });

  it('fills only the trip fields the scan could not read, and never overwrites one it did', async () => {
    onlyCnrapn();
    // airlineCode/depCity were read by OCR; arrCity and both dates were not.
    const seen = renderControlledSpy({
      ...ADJUSTMENT,
      pnr: 'CNRAPM', originalPnr: 'CNRAPM',
      airlineCode: 'EY', depCity: 'ATL', arrCity: null,
      depDate: null, arrDateReturn: null, arrDateFinal: null,
    });

    const search = await screen.findByLabelText(/original pnr/i);
    await userEvent.clear(search);
    await userEvent.type(search, 'CNRAP');
    await userEvent.click(await screen.findByRole('button', { name: /CNRAPN.*0000255/i }, { timeout: 3000 }));

    const picked = seen[seen.length - 1];
    expect(picked.originalPnr).toBe('CNRAPN');
    // Untouched — OCR read these.
    expect(picked.airlineCode).toBe('EY');
    expect(picked.depCity).toBe('ATL');
    // Filled — OCR read nothing.
    expect(picked.arrCity).toBe('COK');
    // A PAST date is kept, unlike adjustment-booking-form's futureOnly(): a scan is historic.
    expect(picked.depDate).toBe('2026-01-16');
    expect(picked.arrDateReturn).toBe('2026-02-07');
    // The reissue's OWN pnr is what gets POSTed as the adjustment's pnr — it must survive.
    expect(picked.pnr).toBe('CNRAPM');
  });

  it('drops a resolved parent when the operator edits the original PNR away from it', async () => {
    vi.mocked(bookings.listBookings).mockImplementation(async (params) =>
      params?.q === 'MHNGLM'
        ? { bookings: [ROW], total: 1, page: 1, pageSize: 50 }
        : { bookings: [], total: 0, page: 1, pageSize: 50 }
    );
    renderControlled({ ...ADJUSTMENT, parentPassengerIds: ['p1'] });

    expect(await screen.findByText(/original passenger resolved/i)).toBeInTheDocument();

    const search = screen.getByLabelText(/original pnr/i);
    await userEvent.clear(search);
    await userEvent.type(search, 'ZZZZZZ');

    await waitFor(
      () => expect(screen.queryByText(/original passenger resolved/i)).not.toBeInTheDocument(),
      { timeout: 3000 }
    );
  });
});
