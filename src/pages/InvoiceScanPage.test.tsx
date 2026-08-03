import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import InvoiceScanPage from './InvoiceScanPage';
import * as scan from '@/utils/invoiceScan/ocr/scanPdf';
import type { ScanResult } from '@/utils/invoiceScan/ocr/scanPdf';
import * as bookings from '@/api/bookings.api';
import * as customersApi from '@/api/customers.api';
import * as flightDataApi from '@/api/flightData.api';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/utils/invoiceScan/ocr/scanPdf');
// Only the fix-round-2 regression test below actually exercises this (typing into Departure
// City) — every other test in this file leaves CodeSearchField's query disabled and never fires
// a real search, so this mock is inert for them.
vi.mock('@/api/flightData.api', () => ({
  searchAirports: vi.fn().mockResolvedValue([
    { code: 'IAH', label: 'George Bush Intercontinental Airport', sublabel: 'Houston, United States' },
  ]),
  searchAirlines: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/api/bookings.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bookings.api')>()),
  createBooking: vi.fn(),
  // `listBookings`/`createAdjustment` back the Reissue/Refund save path (`ScanAdjustmentParent`'s
  // PNR search + `saveScannedAdjustment`'s POST). Every other test in this file only ever renders
  // New/Voided invoices, so these two are simply never called there — mocking them here just
  // stops a Reissue/Refund test from making a real, failing network call in jsdom.
  listBookings: vi.fn(),
  createAdjustment: vi.fn(),
}));
// Default: no match, so every pre-existing test's auto-link keeps failing exactly as it did before
// this mock existed (a real, unmocked `searchCustomers` call would reject in jsdom anyway — no
// server — and the resolver swallows that to `null`). Individual saving tests below override this
// per-test to control whether a passenger auto-links.
vi.mock('@/api/customers.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/customers.api')>()),
  searchCustomers: vi.fn().mockResolvedValue([]),
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InvoiceScanPage />
    </QueryClientProvider>
  );
}

const INVOICE = {
  pageStart: 1, pageEnd: 2, type: 'New' as const,
  invoiceNumber: '0000249', bookingDate: '2026-07-31', pnr: 'MHNGLM',
  passengers: [{ name: 'JACOB/SHIBIN THOMAS', child: false, amount: 4275.29, ticketNumber: 'EY1', confidence: 96 }],
  segments: [], airlineName: 'ETIHAD AIRWAYS',
  depCityText: 'ATLANTA', arrCityText: 'KOCHI',
  depDate: '2026-11-05', arrDateReturn: '2026-11-26', arrDateFinal: '2026-11-26',
  netCcBilling: 4275.29, issues: [],
};

const VOIDED_INVOICE = { ...INVOICE, invoiceNumber: '0000900', type: 'Voided' as const };

// Fix round 3: a resolved match for INVOICE's `airlineName` ('ETIHAD AIRWAYS') — used by every
// test below that needs a New invoice to actually reach Ready (New requires a resolved
// `airlineCode`, auto-resolved from this exact text; see InvoiceScanPage.tsx's new effect).
const AIRLINE_MATCH = { code: 'EY', label: 'Etihad Airways' };

// A three-passenger invoice whose passengers each carry a DIFFERENT ticket amount - the shape that
// makes a per-passenger payment balance distinguishable from one figure spread across all of them.
const THREE_PAX_INVOICE = {
  ...INVOICE,
  invoiceNumber: '0000800',
  netCcBilling: 600,
  passengers: [
    { name: 'ALPHA/ONE', child: false, amount: 100, ticketNumber: null, confidence: 96 },
    { name: 'BETA/TWO', child: false, amount: 200, ticketNumber: null, confidence: 96 },
    { name: 'GAMMA/THREE', child: false, amount: 300, ticketNumber: null, confidence: 96 },
  ],
};

/** A single-passenger New invoice whose one passenger auto-links (ALPHA) and whose ticket amount is
 * the only balance in play — used by the payment tests that need two invoices owing DIFFERENT
 * amounts without the multi-passenger auto-link race getting in the way. */
const ONE_PAX_INVOICE = {
  ...INVOICE,
  invoiceNumber: '0000810',
  netCcBilling: 100,
  passengers: [{ name: 'ALPHA/ONE', child: false, amount: 100, ticketNumber: null, confidence: 96 }],
};

/** Only ALPHA resolves on the mount-time auto-link; BETA/GAMMA come back empty there and are linked
 * by hand below. That is deliberate, and matches how the two existing multi-passenger tests in this
 * file are written: `ScanPassengerRows` fires every passenger's auto-link from ONE mount-time
 * effect, and two resolutions landing in the same React batch both read the same pre-update
 * `customerIds`, so the later write silently drops the earlier link (the known, fail-safe auto-link
 * race - out of scope here). Linking sequentially sidesteps it instead of depending on it. */
async function threeDistinctCustomers(query: string): Promise<customersApi.CustomerSearchResult[]> {
  const q = query.trim().toUpperCase();
  if (q === 'ALPHA') return [{ id: 'c1', firstName: 'One', lastName: 'Alpha', dob: '01-Jan-1990' }];
  // Deliberately NOT keyed on the surname for these two: `resolveCustomerName` auto-links by
  // searching the LAST NAME, so answering 'BETA'/'GAMMA' here would auto-link all three at once and
  // trip the race described above. Answering only on the given name leaves them for the manual
  // search box, which passes whatever the operator types.
  if (q === 'TWO') return [{ id: 'c2', firstName: 'Two', lastName: 'Beta', dob: '02-Jan-1990' }];
  if (q === 'THREE') return [{ id: 'c3', firstName: 'Three', lastName: 'Gamma', dob: '03-Jan-1990' }];
  return [];
}

/** Links passengers 2 and 3 of `THREE_PAX_INVOICE` through the real search UI, after passenger 1's
 * auto-link has settled. */
async function linkRemainingPassengers(): Promise<void> {
  expect(await screen.findByText('Alpha/One')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /select customer for passenger 2/i }));
  await userEvent.type(screen.getByRole('textbox', { name: /search customer for passenger 2/i }), 'Two');
  await userEvent.click(await screen.findByText('Beta/Two'));
  await userEvent.click(screen.getByRole('button', { name: /select customer for passenger 3/i }));
  await userEvent.type(screen.getByRole('textbox', { name: /search customer for passenger 3/i }), 'Three');
  await userEvent.click(await screen.findByText('Gamma/Three'));
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 't', user: { id: 'u1', name: 'A', email: 'a@b.c', role: 'superadmin' } });
  vi.mocked(scan.scanPdf).mockReset();
  vi.mocked(bookings.createBooking).mockReset();
  vi.mocked(bookings.listBookings).mockReset();
  vi.mocked(bookings.createAdjustment).mockReset();
  vi.mocked(customersApi.searchCustomers).mockReset();
  vi.mocked(customersApi.searchCustomers).mockResolvedValue([]);
  // Reset to the SAME defaults the top-level factory mock started with, so every pre-existing
  // test's behavior (a search that types "Hous" resolves the one mocked IAH/Houston match;
  // airline auto-resolution otherwise finds nothing) is unaffected unless a test explicitly
  // overrides it below.
  vi.mocked(flightDataApi.searchAirports).mockReset();
  vi.mocked(flightDataApi.searchAirports).mockResolvedValue([
    { code: 'IAH', label: 'George Bush Intercontinental Airport', sublabel: 'Houston, United States' },
  ]);
  vi.mocked(flightDataApi.searchAirlines).mockReset();
  vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([]);
});

afterEach(() => {
  useAuthStore.setState({ accessToken: null, user: null });
});

describe('InvoiceScanPage', () => {
  it('shows an upload prompt before any file is chosen', () => {
    renderPage();
    expect(screen.getByLabelText(/scanned invoices/i)).toBeInTheDocument();
  });

  it('scans a chosen PDF and lists the invoices it found', async () => {
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [INVOICE], pageImages: new Map([[1, 'data:x']]) });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByText('0000249')).toBeInTheDocument();
    expect(screen.getByText(/1 invoice found/i)).toBeInTheDocument();
  });

  it('marks an invoice with issues as needing attention', async () => {
    vi.mocked(scan.scanPdf).mockResolvedValue({
      invoices: [{ ...INVOICE, issues: ['No PNR found'] }],
      pageImages: new Map(),
    });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByText(/needs attention/i)).toBeInTheDocument();
  });

  it('surfaces a scan failure instead of failing silently', async () => {
    vi.mocked(scan.scanPdf).mockRejectedValue(new Error('bad pdf'));
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    await waitFor(() => expect(screen.getByText(/could not read that pdf/i)).toBeInTheDocument());
  });

  // Fix-round-1 regression test: reproduces the reviewer's scenario exactly (first scan hangs,
  // a second scan is chosen and resolves first, then the first finally settles) and proves the
  // stale first result cannot silently clobber what the operator is already looking at.
  //
  // The file input is disabled while a scan is in flight (belt-and-braces UI fix, same round),
  // so a real user cannot literally open a second OS file picker mid-scan — but the code-level
  // guard (a generation counter) is the actual fix and must hold regardless of that UI
  // affordance, so the second file pick below is dispatched via fireEvent.change directly
  // (bypassing userEvent's disabled-aware pointer checks) to exercise the guard in isolation.
  it('discards a stale scan result if an earlier, slower scan settles after a newer one', async () => {
    let resolveFirstScan: (result: ScanResult) => void = () => {};
    const firstScan = new Promise<ScanResult>((resolve) => {
      resolveFirstScan = resolve;
    });
    const SECOND_INVOICE = { ...INVOICE, invoiceNumber: '0000999' };

    vi.mocked(scan.scanPdf)
      .mockImplementationOnce(() => firstScan)
      .mockResolvedValueOnce({ invoices: [SECOND_INVOICE], pageImages: new Map() });

    renderPage();
    const input = screen.getByLabelText(/scanned invoices/i);

    // First upload — scanPdf's promise never resolves during this test until told to.
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'first.pdf', { type: 'application/pdf' })] },
    });
    await waitFor(() => expect(vi.mocked(scan.scanPdf)).toHaveBeenCalledTimes(1));

    // Second upload while the first is still hanging — resolves immediately and is what the
    // operator should end up looking at.
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'second.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText('0000999')).toBeInTheDocument();

    // The stale first scan settles last. If it were allowed to write state, it would silently
    // replace the screen with the wrong file's results.
    resolveFirstScan({ invoices: [INVOICE], pageImages: new Map() });
    await waitFor(() => expect(vi.mocked(scan.scanPdf)).toHaveBeenCalledTimes(2));
    // Flush a beat past the resolved promise so a (buggy) stale .then() has had its chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText('0000999')).toBeInTheDocument();
    expect(screen.queryByText('0000249')).not.toBeInTheDocument();
  });

  // Fix-round-1 regression test: ScanInvoiceDetail's Voided warning is now derived purely from
  // `invoice.type` (no local component state — see its own file's tests/comments), so this proves
  // it end-to-end through the real page: switching the SELECTED invoice must change what the
  // warning reflects, not carry over whatever the previously-selected invoice last showed.
  it('shows the Voided warning only for a Voided invoice, and switches when the selection changes', async () => {
    const voidedInvoice = { ...INVOICE, invoiceNumber: '0000900', type: 'Voided' as const };
    const newInvoice = { ...INVOICE, invoiceNumber: '0000901', type: 'New' as const };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [voidedInvoice, newInvoice], pageImages: new Map() });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // The first invoice (Voided) is auto-selected on scan completion; its warning shows immediately.
    expect(await screen.findByText(/only the invoice number, date and remark are kept/i)).toBeInTheDocument();

    // Selecting the New invoice must NOT carry the warning over.
    await userEvent.click(screen.getByText('0000901'));
    expect(screen.queryByText(/only the invoice number, date and remark are kept/i)).not.toBeInTheDocument();

    // Selecting back shows it again — proves it's a live derivation from the selected invoice's
    // own data, not state that only happened to reset once.
    await userEvent.click(screen.getByText('0000900'));
    expect(await screen.findByText(/only the invoice number, date and remark are kept/i)).toBeInTheDocument();
  });

  // Fix-round-2 regression test: reproduces the reviewer's exact probe. `CodeSearchField` keeps
  // its own local query/dropdown state that does not reset when its `value` prop changes, so
  // switching the selected invoice while a suggestion dropdown is still open used to leave a
  // stale, still-clickable suggestion floating over the NEWLY-selected invoice's field — clicking
  // it wrote the stale match's code onto the wrong invoice. `ScanInvoiceDetail` now keys each
  // CodeSearchField on `invoice.id` (see its own file's comment on the Airline field) specifically
  // to force a remount — and therefore a clean dropdown/search-state reset — on every switch.
  it('does not let a stale suggestion from a previous invoice survive a switch and write into the newly-selected invoice', async () => {
    const invoiceA = { ...INVOICE, invoiceNumber: '0000910' };
    const invoiceB = { ...INVOICE, invoiceNumber: '0000911', depCityText: 'DALLAS' };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [invoiceA, invoiceB], pageImages: new Map() });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // Invoice A (auto-selected) — type into Departure City so the suggestion dropdown opens.
    const depCityField = await screen.findByLabelText('Departure City');
    await userEvent.type(depCityField, 'Hous');
    await screen.findByRole('option', { name: /Houston/i });

    // Switch to invoice B WITHOUT dismissing the still-open dropdown — the exact reviewer probe.
    await userEvent.click(screen.getByText('0000911'));

    // The stale suggestion must not survive the switch: if it did, it would still be clickable
    // and would write IAH into invoice B's depCity instead of invoice A's. This is the actual
    // regression this test guards — the remount-key reset of CodeSearchField's own local
    // query/dropdown state — and is unaffected by fix round 3's auto-resolution below.
    expect(screen.queryByRole('option', { name: /Houston/i })).not.toBeInTheDocument();
    // Fix round 3: invoice B's Departure City is no longer blank here — its OWN `depCityText`
    // ("DALLAS") now auto-resolves via the same lazy-on-selection effect that resolves
    // airlineCode (see InvoiceScanPage.tsx), and the mocked `searchAirports` in this file always
    // returns the one IAH match regardless of query text. This is invoice B's OWN legitimate
    // resolution, not a leaked value from invoice A's interaction — proven by the assertion above
    // (no stale, still-clickable Houston option survived the switch for anything to have leaked
    // FROM).
    await waitFor(() => expect(screen.getByLabelText('Departure City')).toHaveValue('IAH'));
  });
});

// --- Final review, I5: repeat-upload state leak + colliding invoice ids ----------------------
//
// A new scan cleared only `invoices`/`error`/`progress`. `duplicates` was never cleared, ids
// regenerated identically as `scan-${index}`, and `selectedId` stayed `'scan-0'` — so re-uploading
// (which the spec calls the normal recovery path, since a client-side batch cannot be resumed) left
// the PREVIOUS batch's per-invoice state attached to a completely different PDF's invoice.
describe('InvoiceScanPage repeat upload', () => {
  it('does not leave a previous upload\'s duplicate warning attached to a new PDF\'s invoice', async () => {
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [VOIDED_INVOICE], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          error: {
            code: 'DUPLICATE_BOOKING_WARNING',
            duplicate: {
              id: 'b9', invoiceNumber: '0000900', bookingDate: '2026-07-31', pnr: null, passengerNames: ['VOID'],
            },
          },
        },
      },
    });
    renderPage();
    const input = screen.getByLabelText(/scanned invoices/i);

    await userEvent.upload(input, new File(['x'], 'first.pdf', { type: 'application/pdf' }));
    await userEvent.click(await screen.findByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/already exists with the same date and pnr/i)).toBeInTheDocument();

    // The operator re-uploads — a DIFFERENT stack, whose first invoice is a genuinely new one.
    vi.mocked(scan.scanPdf).mockResolvedValue({
      invoices: [{ ...VOIDED_INVOICE, invoiceNumber: '0000999' }],
      pageImages: new Map(),
    });
    await userEvent.upload(input, new File(['y'], 'second.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText('0000999')).toBeInTheDocument();
    // THE bug: the stale amber panel used to render against the new invoice, and its only Save
    // affordance is "Save anyway", which sends confirmDuplicate: true — bypassing the real
    // duplicate check for an invoice that was never checked at all.
    expect(screen.queryByText(/already exists with the same date and pnr/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save anyway/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  // NOTE ON WHAT IS **NOT** TESTED HERE, and why — the per-batch invoice ids.
  //
  // I5's second half was that ids regenerate identically across uploads (`scan-0`, `scan-1`, …),
  // which in principle lets any id-keyed state from batch N apply to batch N+1 — including the
  // `${invoice.id}-dep-city` remount keys that exist precisely to stop a stale `CodeSearchField`
  // dropdown writing into the wrong invoice. Ids are now `scan-<batch>-<index>`.
  //
  // A probe was written for the obvious consequence (type into Departure City, re-upload without
  // dismissing the dropdown, expect the stale option gone) and it PASSED against the pre-fix code,
  // i.e. it proved nothing. The reason is worth recording: `handleFile` calls `setInvoices([])`
  // synchronously before awaiting the scan, so `invoices.length > 0` goes false and the ENTIRE
  // master-detail grid unmounts for the duration of the scan — every child's local state goes with
  // it regardless of any key. The id collision therefore has no observable consequence today; the
  // per-batch state reset above is what actually closes I5, and unique ids are defence in depth
  // against a future refactor that stops clearing (or stops unmounting). A hollow test asserting
  // otherwise was deliberately not kept.
});

// --- Final review, minor: no terminal `saved` state ------------------------------------------
//
// `mergeResolved` and `handleDetailChange` both recomputed status UNCONDITIONALLY via `statusFor`,
// which only ever returns `'ready'`/`'attention'` — so any post-save edit, or a city lookup that
// happened to land after the save completed, silently flipped a `'saved'` row back to `'ready'`.
// Save was re-enabled on an invoice already in the ledger, and if the edit touched
// `invoiceNumber`/`bookingDate`/`pnr` the backend's own 409 duplicate check could no longer catch
// the second write either, since the dedupe triple no longer matched. `clearDuplicate` already
// guarded its recompute on the current status; these two did not.
// Final review, I6: `mergeResolved`'s `|| inv[field]` anti-clobber guard had no test — deleting it
// left all 85 scan tests green. Its whole job is to stop a lookup that resolves LATE from
// overwriting a code the operator has since typed or picked by hand, which is exactly the silent
// wrong-value class this feature's design is built to avoid.
describe('InvoiceScanPage auto-resolution anti-clobber', () => {
  it('never overwrites a code the operator entered while the lookup was still in flight', async () => {
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([]);
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([]);
    let resolveAirports: (options: { code: string; label: string }[]) => void = () => {};
    const pendingAirports = new Promise<{ code: string; label: string }[]>((resolve) => {
      resolveAirports = resolve;
    });
    vi.mocked(flightDataApi.searchAirports).mockReturnValue(pendingAirports);

    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [INVOICE], pageImages: new Map() });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // The operator gets bored waiting and types the code straight in — the field is free text.
    const depCityField = await screen.findByLabelText('Departure City');
    fireEvent.change(depCityField, { target: { value: 'DFW' } });
    expect(depCityField).toHaveValue('DFW');

    // The lookup for the OCR'd 'ATLANTA' finally comes back with a different answer.
    resolveAirports([{ code: 'ATL', label: 'Atlanta' }]);
    // Wait for the resolution to have actually landed somewhere observable (Arrival City was still
    // blank, so it legitimately takes the resolved code) before asserting Departure City survived.
    await waitFor(() => expect(screen.getByLabelText('Arrival City')).toHaveValue('ATL'));

    expect(screen.getByLabelText('Departure City')).toHaveValue('DFW');
  });
});

describe('InvoiceScanPage terminal saved state', () => {
  it('keeps a saved invoice saved when the operator edits it afterwards', async () => {
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [VOIDED_INVOICE], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000900', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );
    await userEvent.click(await screen.findByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());

    // Editing the invoice number is the WORST case: it changes the backend's dedupe triple
    // (invoiceNumber + bookingDate + pnr), so a second POST would not even 409.
    fireEvent.change(screen.getByLabelText('Invoice number'), { target: { value: '0000901' } });

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(bookings.createBooking).toHaveBeenCalledTimes(1);
  });

  it('keeps a saved invoice saved when a background code lookup resolves after the save', async () => {
    const MATCH: customersApi.CustomerSearchResult = {
      id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '01-Jan-1990',
    };
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([MATCH]);
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([AIRLINE_MATCH]);
    // The airport lookup is held open past the save, reproducing the exact window the finding
    // describes: `mergeResolved` lands on an invoice that is already `'saved'`.
    let resolveAirports: (options: { code: string; label: string }[]) => void = () => {};
    const pendingAirports = new Promise<{ code: string; label: string }[]>((resolve) => {
      resolveAirports = resolve;
    });
    vi.mocked(flightDataApi.searchAirports).mockReturnValue(pendingAirports);

    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [INVOICE], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000249', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByText('Jacob/Shibin Thomas')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());

    // The city lookup finally comes back, long after the invoice is in the ledger.
    resolveAirports([{ code: 'ATL', label: 'Atlanta' }]);
    await waitFor(() => expect(screen.getByLabelText('Departure City')).toHaveValue('ATL'));

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(bookings.createBooking).toHaveBeenCalledTimes(1);
  });
});

describe('InvoiceScanPage saving', () => {
  it('disables "Save all ready" until at least one invoice is ready', async () => {
    // A freshly-scanned New invoice starts unlinked (customerIds all null), so statusFor marks it
    // "attention" — the batch button must not be clickable yet.
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [INVOICE], pageImages: new Map() });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByRole('button', { name: /save all ready/i })).toBeDisabled();
  });

  it('saves a Voided invoice, invalidates the Bookings/Sales caches, and toasts success', async () => {
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [VOIDED_INVOICE], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000900', passengers: [] });
    const successSpy = vi.spyOn(toast, 'success');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <InvoiceScanPage />
      </QueryClientProvider>
    );

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // A Voided invoice is exempt from the customer-link check, so it is Ready immediately.
    expect(await screen.findByRole('button', { name: /save all ready/i })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(bookings.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceNumber: '0000900', voided: true, passengers: [{ passengerName: 'VOID', amount: 0 }] })
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    expect(successSpy).toHaveBeenCalledWith('Invoice saved');
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['bookings'] }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['sales'] }));
  });

  it('surfaces the duplicate warning and resolves it via "Save anyway" without ever auto-confirming', async () => {
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [VOIDED_INVOICE], pageImages: new Map() });
    vi.mocked(bookings.createBooking)
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            error: {
              code: 'DUPLICATE_BOOKING_WARNING',
              duplicate: {
                id: 'b9', invoiceNumber: '0000900', bookingDate: '2026-07-31', pnr: null, passengerNames: ['VOID'],
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({ id: 'b1', invoiceNumber: '0000900', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/already exists with the same date and pnr/i)).toBeInTheDocument();
    // The plain Save button must be gone while the warning is up — the only way forward is an
    // explicit choice, never a silent retry of the exact same request.
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /save anyway/i }));

    expect(bookings.createBooking).toHaveBeenLastCalledWith(expect.objectContaining({ confirmDuplicate: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    expect(screen.queryByText(/already exists with the same date and pnr/i)).not.toBeInTheDocument();
  });

  it('"Save all ready" saves every ready invoice independently — one failure does not stop the rest', async () => {
    const secondVoided = { ...VOIDED_INVOICE, invoiceNumber: '0000901' };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [VOIDED_INVOICE, secondVoided], pageImages: new Map() });
    vi.mocked(bookings.createBooking)
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 400, data: { error: { message: 'Booking date is required' } } },
      })
      .mockResolvedValueOnce({ id: 'b2', invoiceNumber: '0000901', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    await userEvent.click(await screen.findByRole('button', { name: /save all ready/i }));

    await waitFor(() => expect(bookings.createBooking).toHaveBeenCalledTimes(2));
    const rows = screen.getAllByRole('row');
    // rows[0] is the header row; the two invoices keep the scan order.
    await waitFor(() => expect(within(rows[1]).getByText('Failed')).toBeInTheDocument());
    expect(within(rows[2]).getByText('Saved')).toBeInTheDocument();
    // The first (failed) invoice is auto-selected, so its own error surfaces in the detail panel.
    expect(screen.getByText('Booking date is required')).toBeInTheDocument();
  });

  // Fix round 1, Critical 1: a null passenger amount ALWAYS raises an issue (see
  // parsePassengers.ts's `missingAmounts` check) and previously the Save button was gated only on
  // `status !== 'saved'` — so an operator could click Save on an invoice whose amount field is
  // visibly blank and it would write a real $0 into the ledger with no warning. The customer is
  // deliberately auto-linked here (searchCustomers resolves a unique match) so the ONLY remaining
  // reason this invoice isn't Ready is the unread amount — isolating this test from Important 3
  // below.
  it('never lets Save write a blank/unread amount as a silent $0 — Save stays disabled', async () => {
    const MATCH: customersApi.CustomerSearchResult = {
      id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '01-Jan-1990',
    };
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([MATCH]);

    const blankAmountInvoice = {
      ...INVOICE,
      passengers: [{ ...INVOICE.passengers[0], amount: null }],
      issues: ['1 passenger amount could not be read from the ticket lines and must be entered manually'],
    };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [blankAmountInvoice], pageImages: new Map() });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // Wait for auto-link to actually settle — proves the ONLY remaining problem is the amount.
    expect(await screen.findByText('Jacob/Shibin Thomas')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();

    await userEvent.click(saveButton);
    expect(bookings.createBooking).not.toHaveBeenCalled();
  });

  // Fix round 1, Important 3: scan-passenger-rows.tsx documents that every non-Voided passenger
  // must resolve to a real Customer before saving, "with NO grandfathering exemption" — but the
  // same ungated Save button let an unlinked passenger through too. The default customersApi mock
  // (no match) keeps this passenger unlinked, isolating this test from the amount case above.
  it('blocks Save while any non-Voided passenger is still unlinked', async () => {
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [INVOICE], pageImages: new Map() });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByText(/not linked/i)).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();

    await userEvent.click(saveButton);
    expect(bookings.createBooking).not.toHaveBeenCalled();
  });

  // Fix round 1, Critical 2: a duplicate outcome used to leave `status` untouched, so a 409 hit
  // during "Save all ready" left that row's badge reading "Ready" — visually identical to a row
  // nobody had attempted. This proves the badge now reads something else, AND that a batch summary
  // makes the mixed outcome visible without clicking into any row.
  it('flags a 409 duplicate hit during "Save all ready" as needing a decision, never silently as Ready', async () => {
    const secondVoided = { ...VOIDED_INVOICE, invoiceNumber: '0000901' };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [VOIDED_INVOICE, secondVoided], pageImages: new Map() });
    vi.mocked(bookings.createBooking)
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            error: {
              code: 'DUPLICATE_BOOKING_WARNING',
              duplicate: {
                id: 'b9', invoiceNumber: '0000900', bookingDate: '2026-07-31', pnr: null, passengerNames: ['VOID'],
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({ id: 'b2', invoiceNumber: '0000901', passengers: [] });
    const errorSpy = vi.spyOn(toast, 'error');
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    await userEvent.click(await screen.findByRole('button', { name: /save all ready/i }));

    await waitFor(() => expect(bookings.createBooking).toHaveBeenCalledTimes(2));
    const rows = screen.getAllByRole('row');
    await waitFor(() => expect(within(rows[1]).getByText('Needs decision')).toBeInTheDocument());
    expect(within(rows[1]).queryByText('Ready')).not.toBeInTheDocument();
    expect(within(rows[2]).getByText('Saved')).toBeInTheDocument();

    // The first (duplicate) invoice is auto-selected, so its own decision panel is visible too —
    // not just the list badge.
    expect(screen.getByText(/already exists with the same date and pnr/i)).toBeInTheDocument();

    // Belt-and-braces: a summary makes the mixed outcome visible even without inspecting the table.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('1 saved'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('1 needs a decision'));
  });

  // Fix round 1's Important 4 is REVERSED by the final review's I2 fix, and deliberately so. That
  // round disabled the batch while Pending because ONE typed "Amount owed" figure was applied to
  // every invoice the batch touched, and different invoices genuinely owe different balances. There
  // is no such shared figure any more — each passenger owes its own ticket price — so the batch is
  // safe under Pending, and this pins the stronger property the old test only worked around: two
  // invoices owing DIFFERENT balances both save correctly, in one batch, with nothing typed.
  it('saves every ready invoice against its own balance in one batch while Payment status is Pending', async () => {
    vi.mocked(customersApi.searchCustomers).mockImplementation(threeDistinctCustomers);
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([AIRLINE_MATCH]);
    const invoiceA = { ...ONE_PAX_INVOICE, invoiceNumber: '0000810' };
    const invoiceB = {
      ...ONE_PAX_INVOICE,
      invoiceNumber: '0000811',
      netCcBilling: 250,
      passengers: [{ ...ONE_PAX_INVOICE.passengers[0], amount: 250 }],
    };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [invoiceA, invoiceB], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000810', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // Each invoice must be visited once so its own airline/customer resolution settles.
    expect(await screen.findByText('Alpha/One')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByText('0000811'));
    await waitFor(() => expect(screen.getByText('Alpha/One')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());

    await userEvent.click(screen.getByRole('combobox', { name: 'Default payment status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Pending' }));

    const saveAllButton = screen.getByRole('button', { name: /save all ready/i });
    expect(saveAllButton).toBeEnabled();
    await userEvent.click(saveAllButton);

    await waitFor(() => expect(bookings.createBooking).toHaveBeenCalledTimes(2));
    expect(bookings.createBooking).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        invoiceNumber: '0000810',
        passengers: [expect.objectContaining({ payment: expect.objectContaining({ status: 'pending', amount: 100 }) })],
      })
    );
    expect(bookings.createBooking).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        invoiceNumber: '0000811',
        passengers: [expect.objectContaining({ payment: expect.objectContaining({ status: 'pending', amount: 250 }) })],
      })
    );
  });

  // Final review, I2: `payment.amount` is a PER-PASSENGER outstanding balance, but the page held
  // ONE shared "Amount owed" figure and `toCreateBookingInput` spread that single `PaymentInput`
  // onto every passenger - so 500 typed on a 3-passenger Pending invoice recorded $1,500
  // outstanding. The backend's cap is same-document (a passenger's pending <= its own amount), so
  // it validated cleanly and the wrong money entered the ledger silently.
  //
  // The resolution follows `booking-form.tsx`'s shared-payment mode, which deliberately has NO
  // shared amount field for exactly this reason: under a shared Pending status each passenger owes
  // its OWN full ticket price. So the field is gone and each passenger's balance is its own amount.
  it('records each passenger owing its OWN full ticket amount on a Pending save, never one figure spread across all of them', async () => {
    vi.mocked(customersApi.searchCustomers).mockImplementation(threeDistinctCustomers);
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([AIRLINE_MATCH]);
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [THREE_PAX_INVOICE], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000800', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );
    await linkRemainingPassengers();

    await userEvent.click(screen.getByRole('combobox', { name: 'Default payment status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Pending' }));

    // There is deliberately no shared "Amount owed" control to type into any more.
    expect(screen.queryByLabelText('Amount owed')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(bookings.createBooking).toHaveBeenCalled());
    const sent = vi.mocked(bookings.createBooking).mock.calls[0][0];
    expect(sent.passengers.map((p) => p.payment?.amount)).toEqual([100, 200, 300]);
    expect(sent.passengers.every((p) => p.payment?.status === 'pending')).toBe(true);
  });

  // Paid is the other half of the same rule and must stay exactly as it was: nothing is owed, so
  // every passenger's balance is 0 regardless of its ticket price.
  it('records a zero balance for every passenger on a Paid save', async () => {
    vi.mocked(customersApi.searchCustomers).mockImplementation(threeDistinctCustomers);
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([AIRLINE_MATCH]);
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [THREE_PAX_INVOICE], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000800', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );
    await linkRemainingPassengers();

    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(bookings.createBooking).toHaveBeenCalled());
    const sent = vi.mocked(bookings.createBooking).mock.calls[0][0];
    expect(sent.passengers.map((p) => p.payment?.amount)).toEqual([0, 0, 0]);
    expect(sent.passengers.every((p) => p.payment?.status === 'paid')).toBe(true);
  });

  // Fix round 1's Minor 2 ("requires a positive Amount owed before a Pending invoice can be saved")
  // is deleted rather than rewritten: it pinned a client-side guard on a control that no longer
  // exists, and the condition it protected against — a blank/zero shared figure reaching the
  // backend's `amount > 0` refine — is now unrepresentable, since the figure IS the passenger's own
  // ticket amount and `statusFor` already blocks Ready while any passenger amount is unread. The
  // two "own balance" tests above are its replacement.

  // Task 13: Reissue/Refund now save as an adjustment against the resolved original passenger,
  // rather than the previous "not available yet" dead end. Both auto-resolutions (customer link
  // via ScanPassengerRows, original passenger via ScanAdjustmentParent) must settle before Save
  // is reachable — proving this end-to-end through the real page is what actually exercises the
  // routing in `performSave`, not just the two units in isolation.
  it('saves a Reissue invoice as an adjustment against its resolved original passenger', async () => {
    const reissueInvoice = { ...INVOICE, type: 'Reissue' as const, invoiceNumber: '0000950' };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [reissueInvoice], pageImages: new Map() });
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([
      { id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '01-Jan-1990' },
    ]);
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [
        {
          id: 'p1', bookingDate: '2026-01-05', invoiceNumber: '0000100',
          passengerName: 'Jacob/Shibin Thomas', amount: 4275.29, pnr: 'MHNGLM', bookingType: 'New',
        },
      ],
      total: 1, page: 1, pageSize: 50,
    });
    vi.mocked(bookings.createAdjustment).mockResolvedValue({
      id: 'a1', bookingType: 'Reissue', parentRef: 'p1', amount: 4275.29,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <InvoiceScanPage />
      </QueryClientProvider>
    );

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // Both auto-resolutions (customer link, original passenger) must settle before Save unlocks.
    expect(await screen.findByText('Jacob/Shibin Thomas')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Routed through the adjustment endpoint, against the resolved original passenger — never
    // the New-booking endpoint (which would silently create a bogus booking instead).
    expect(bookings.createAdjustment).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ bookingType: 'Reissue', pnr: 'MHNGLM', bookingDate: '2026-07-31' })
    );
    expect(bookings.createBooking).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['bookings'] }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['sales'] }));
  });

  // Fix round 2, THE central regression: `issues` is a frozen scan-time snapshot — nothing ever
  // recomputed it — and gating Save on `status === 'ready'` (fix round 1's own fix) meant an
  // invoice carrying the single most common OCR finding (a blank/unread passenger amount, ~1 in 6
  // per Task 1's own measurement) could NEVER become Ready again, even after the operator typed in
  // the correct figure. `statusFor` no longer gates on `issues` at all — issues are advisory
  // display text only; the LIVE passenger data is what's re-derived. This is the exact scenario the
  // reviewer's own probe used: blank amount, customer auto-linked, valid amount typed in.
  it('re-enables Save once a blank/unread amount is corrected — the live status re-derivation', async () => {
    const MATCH: customersApi.CustomerSearchResult = {
      id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '01-Jan-1990',
    };
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([MATCH]);
    // Fix round 3: a New invoice also needs its airline auto-resolved to reach Ready — isolates
    // this test to the amount exactly as the comment above says, now that airlineCode is ALSO a
    // live gate (see reviewInvoice.ts's statusFor).
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([AIRLINE_MATCH]);

    const blankAmountInvoice = {
      ...INVOICE,
      passengers: [{ ...INVOICE.passengers[0], amount: null }],
      issues: ['1 passenger amount could not be read from the scan and needs manual entry'],
    };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [blankAmountInvoice], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000249', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // Auto-link settles first — isolates this test to the amount, same as fix round 1's own test.
    expect(await screen.findByText('Jacob/Shibin Thomas')).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();

    // The operator reads the correct figure off the page image and types it in.
    fireEvent.change(screen.getByLabelText('Amount for passenger 1'), { target: { value: '4275.29' } });

    // THE assertion the reviewer's probe found failing (timed out) against the pre-fix code.
    await waitFor(() => expect(saveButton).toBeEnabled());

    await userEvent.click(saveButton);
    expect(bookings.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ passengers: [expect.objectContaining({ amount: 4275.29 })] })
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
  });

  // Fix round 2's Finding 4 residual and fix round 3's Minor both existed only because ONE
  // page-level "Amount owed" string was shared by every save — it had to be cleared after a success,
  // and again on a selection change, or the NEXT invoice silently inherited the previous one's
  // figure. (The deleted companion test 'clears a Pending "Amount owed" figure on switching
  // invoices even after a failed save' pinned that second clear.) The I2 fix removes the shared
  // figure entirely, so the carry-over is structurally impossible rather than merely cleared at the
  // right moments — this pins the property both tests were really protecting: two invoices saved one
  // after the other each record their OWN balance, with nothing typed at any point.
  //
  // Both invoices share `airlineName` ('ETIHAD AIRWAYS'), so this also still exercises the shared
  // resolver's memoisation across the selection switch (see InvoiceScanPage.tsx's `scanResolverRef`).
  it('records each invoice against its own balance on sequential individual Pending saves', async () => {
    vi.mocked(customersApi.searchCustomers).mockImplementation(threeDistinctCustomers);
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([AIRLINE_MATCH]);

    const invoiceA = { ...ONE_PAX_INVOICE, invoiceNumber: '0000820' };
    const invoiceB = {
      ...ONE_PAX_INVOICE,
      invoiceNumber: '0000821',
      netCcBilling: 250,
      passengers: [{ ...ONE_PAX_INVOICE.passengers[0], amount: 250 }],
    };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [invoiceA, invoiceB], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000820', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByText('Alpha/One')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Default payment status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Pending' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    expect(bookings.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceNumber: '0000820',
        passengers: [expect.objectContaining({ payment: expect.objectContaining({ amount: 100 }) })],
      })
    );

    // Switch to invoice B — nothing to retype, and nothing inherited from A.
    await userEvent.click(screen.getByText('0000821'));
    await waitFor(() => expect(screen.getByText('Alpha/One')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(bookings.createBooking).toHaveBeenCalledTimes(2));
    expect(bookings.createBooking).toHaveBeenLastCalledWith(
      expect.objectContaining({
        invoiceNumber: '0000821',
        passengers: [expect.objectContaining({ payment: expect.objectContaining({ amount: 250 }) })],
      })
    );
  });

  // Fix round 3, Critical: `airlineCode`/`depCity`/`arrCity` were NEVER wired to `resolve.ts`'s
  // existing airline/airport resolvers — only the customer resolver was ever actually called.
  // `airlineCode` in particular stayed permanently null, so a New invoice's own "Save all ready"
  // 400'd at the backend's `voided || (pnr && airlineCode)` refine on every single invoice. This
  // proves the new lazy-on-selection effect actually resolves all three from the raw OCR'd text
  // (`airlineName`/`depCityText`/`arrCityText`) with NO operator action beyond the invoice being
  // reviewed (here: the default first-invoice auto-selection), and that this is what unblocks Save.
  it("auto-resolves a New invoice's airline/cities from the OCR'd text once reviewed, unblocking Save", async () => {
    const MATCH: customersApi.CustomerSearchResult = {
      id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '01-Jan-1990',
    };
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([MATCH]);
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([AIRLINE_MATCH]);
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [INVOICE], pageImages: new Map() });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByText('Jacob/Shibin Thomas')).toBeInTheDocument();
    // Resolved from `airlineName: 'ETIHAD AIRWAYS'` / `depCityText: 'ATLANTA'` / `arrCityText:
    // 'KOCHI'` — none of these fields were ever typed by the test.
    await waitFor(() => expect(screen.getByLabelText('Airline')).toHaveValue('EY'));
    expect(screen.getByLabelText('Departure City')).toHaveValue('IAH'); // the mocked searchAirports match
    expect(screen.getByLabelText('Arrival City')).toHaveValue('IAH');

    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
  });

  // Fix round 3: `resolve.ts`'s memoisation only pays off if the SAME resolver instance persists
  // across invoice selections — a batch of dozens of invoices realistically repeats only a
  // handful of distinct airlines/cities. Two invoices sharing the identical `airlineName` must
  // trigger only ONE `searchAirlines` call total, not one per invoice.
  it('memoises airline resolution across invoice selections instead of re-requesting per invoice', async () => {
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([AIRLINE_MATCH]);
    const invoiceA = { ...INVOICE, invoiceNumber: '0000910' };
    const invoiceB = { ...INVOICE, invoiceNumber: '0000911' }; // identical airlineName
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [invoiceA, invoiceB], pageImages: new Map() });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    await waitFor(() => expect(screen.getByLabelText('Airline')).toHaveValue('EY'));
    await waitFor(() => expect(vi.mocked(flightDataApi.searchAirlines)).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByText('0000911'));
    await waitFor(() => expect(screen.getByLabelText('Airline')).toHaveValue('EY'));

    // Still just ONE call total — invoice B's identical airline text was served from the resolver's
    // own memoised cache, not a second network request.
    expect(vi.mocked(flightDataApi.searchAirlines)).toHaveBeenCalledTimes(1);
  });

  // Fix round 3, Important: a well-formed OCR misread (4,275.29 read as 4,215.29) leaves `amount`
  // non-null, so the amount gate passes and the badge reads Ready — but the passenger total then
  // disagrees with the invoice's own printed NET CC BILLING, and the amber "Issues to review"
  // panel that would show this only ever renders for the SELECTED invoice. "Save all ready" must
  // skip such an invoice entirely rather than write the misread figure unattended; the individual
  // Save button (fix round 2's "operator may override" case) must still work on the very same row.
  it('excludes a reconciliation mismatch from "Save all ready" but still allows the individual Save button', async () => {
    const MATCH: customersApi.CustomerSearchResult = {
      id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '01-Jan-1990',
    };
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([MATCH]);
    vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([AIRLINE_MATCH]);

    // netCcBilling (4275.29, inherited from INVOICE) disagrees with this passenger's own amount.
    const mismatchInvoice = {
      ...INVOICE,
      invoiceNumber: '0000700',
      passengers: [{ ...INVOICE.passengers[0], amount: 4215.29 }],
    };
    const goodInvoice = { ...INVOICE, invoiceNumber: '0000701' };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [mismatchInvoice, goodInvoice], pageImages: new Map() });
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000701', passengers: [] });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // Both invoices must actually be visited once (mirroring how an operator reviews a batch) so
    // each one's own airline/link resolution settles and it genuinely reaches Ready.
    expect(await screen.findByText('Jacob/Shibin Thomas')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByText('0000701'));
    await waitFor(() => expect(screen.getByText('Jacob/Shibin Thomas')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());

    // "Save all ready" must skip the mismatched invoice entirely — only the good one gets saved.
    await userEvent.click(screen.getByRole('button', { name: /save all ready/i }));
    await waitFor(() => expect(bookings.createBooking).toHaveBeenCalledTimes(1));
    expect(bookings.createBooking).toHaveBeenCalledWith(expect.objectContaining({ invoiceNumber: '0000701' }));
    expect(bookings.createBooking).not.toHaveBeenCalledWith(expect.objectContaining({ invoiceNumber: '0000700' }));

    // The operator can still explicitly save the mismatched invoice via the individual button.
    await userEvent.click(screen.getByText('0000700'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(bookings.createBooking).toHaveBeenCalledTimes(2));
    expect(bookings.createBooking).toHaveBeenLastCalledWith(expect.objectContaining({ invoiceNumber: '0000700' }));
  });

  // Fix round 2, Important 1: the unit tests in `saveScannedInvoice.test.ts` pin the retry-skip
  // logic by HAND-FEEDING `adjustmentIds`/`adjustmentAmounts` — they prove the function behaves
  // correctly given that state, never that the PAGE actually produces it. Deleting
  // `recordAdjustmentProgress`'s body (or dropping the `onProgress` argument at its call site in
  // `performSave`) leaves every other test in this file green while a retried Reissue save
  // silently double-posts — this test is what actually exercises that wiring end-to-end.
  it('does not re-post an already-succeeded adjustment when the operator retries after a partial failure', async () => {
    const reissueInvoice = {
      ...INVOICE,
      type: 'Reissue' as const,
      invoiceNumber: '0000960',
      passengers: [
        { name: 'JACOB/SHIBIN THOMAS', child: false, amount: 100, ticketNumber: 'EY1', confidence: 96 },
        { name: 'PAUL/MICHAELA ROSE', child: true, amount: 200, ticketNumber: 'EY2', confidence: 96 },
      ],
    };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [reissueInvoice], pageImages: new Map() });
    // `resolveCustomerName` (resolve.ts) searches by LAST NAME (the text before '/'). Passenger 1
    // auto-links via that lookup ("JACOB"); passenger 2 is linked MANUALLY, via the search box,
    // deliberately AFTER passenger 1's auto-link has already settled — `ScanPassengerRows` fires
    // both passengers' auto-link lookups from ONE mount-time effect, and if a second one also
    // auto-resolves in the very same tick, both callbacks can read the same pre-update
    // `customerIds` and the later one silently overwrites the earlier one's link (a real,
    // pre-existing race in that component, orthogonal to this fix — sidestepped here, not
    // something this task is scoped to repair).
    vi.mocked(customersApi.searchCustomers).mockImplementation(async (query: string) => {
      if (query.toUpperCase() === 'JACOB') {
        return [{ id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '01-Jan-1990' }];
      }
      if (query.toUpperCase() === 'MICHAELA') {
        return [{ id: 'c2', firstName: 'Michaela', middleName: 'Rose', lastName: 'Paul', dob: '01-Jan-1990' }];
      }
      return []; // includes the auto-link's own "PAUL" lookup — passenger 2 must not auto-link
    });
    // Two candidate rows sharing the invoice's PNR — deliberately NOT auto-selectable (rows.length
    // > 1), so both must be picked by hand, exactly like a real shared-PNR family booking.
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [
        {
          id: 'p1', bookingDate: '2026-01-05', invoiceNumber: '0000100',
          passengerName: 'Jacob/Shibin Thomas', amount: 100, pnr: 'MHNGLM', bookingType: 'New',
        },
        {
          id: 'p2', bookingDate: '2026-01-05', invoiceNumber: '0000100',
          passengerName: 'Paul/Michaela Rose', amount: 200, pnr: 'MHNGLM', bookingType: 'New',
        },
      ],
      total: 2, page: 1, pageSize: 50,
    });
    // Attempt 1: p1 succeeds, p2 fails. Attempt 2 (retry): only p2 is re-sent, and succeeds.
    vi.mocked(bookings.createAdjustment)
      .mockResolvedValueOnce({ id: 'a1', bookingType: 'Reissue', parentRef: 'p1', amount: 100 })
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 400, data: { error: { message: 'boom' } } },
      })
      .mockResolvedValueOnce({ id: 'a2', bookingType: 'Reissue', parentRef: 'p2', amount: 200 });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    // Passenger 1 auto-links. Only once that's settled do we manually link passenger 2 — see the
    // comment above on why these are kept sequential rather than both auto-linking at once.
    expect(await screen.findByText('Jacob/Shibin Thomas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /select customer for passenger 2/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /search customer for passenger 2/i }), 'Michaela');
    await userEvent.click(await screen.findByText('Paul/Michaela Rose'));

    // Manually resolve both original passengers (2 candidates on the shared PNR — no auto-select).
    await userEvent.click(
      await screen.findByRole('combobox', { name: /original passenger for jacob\/shibin thomas/i })
    );
    await userEvent.click(await screen.findByRole('option', { name: /jacob\/shibin thomas/i }));
    await userEvent.click(
      await screen.findByRole('combobox', { name: /original passenger for paul\/michaela rose/i })
    );
    await userEvent.click(await screen.findByRole('option', { name: /paul\/michaela rose/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // First attempt: p1 posted (succeeds), p2 posted (fails) — 2 calls, invoice now 'failed'.
    await waitFor(() => expect(bookings.createAdjustment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());

    // Retry via the same Save button (status is 'failed', which `canAttemptSave` permits).
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    // THE assertion: 3 calls total (not 4) — the retry re-sent ONLY p2, never re-posting p1.
    expect(bookings.createAdjustment).toHaveBeenCalledTimes(3);
    const p1Calls = vi.mocked(bookings.createAdjustment).mock.calls.filter(([parentId]) => parentId === 'p1');
    expect(p1Calls).toHaveLength(1);
    const p2Calls = vi.mocked(bookings.createAdjustment).mock.calls.filter(([parentId]) => parentId === 'p2');
    expect(p2Calls).toHaveLength(2); // the failed attempt, then the successful retry
  });

  // Fix round 2, Minor 4: `saveScannedAdjustment` correctly skips an already-posted passenger on
  // retry (see the test above) — but silently ignoring an operator's correction is its own bug.
  // If they edit passenger 1's amount AFTER its adjustment already succeeded, then re-save, nothing
  // ever told them the new figure was never sent.
  it('warns when an already-posted adjustment amount was edited and will not be re-sent', async () => {
    const reissueInvoice = {
      ...INVOICE,
      type: 'Reissue' as const,
      invoiceNumber: '0000961',
      passengers: [
        { name: 'JACOB/SHIBIN THOMAS', child: false, amount: 100, ticketNumber: 'EY1', confidence: 96 },
        { name: 'PAUL/MICHAELA ROSE', child: true, amount: 200, ticketNumber: 'EY2', confidence: 96 },
      ],
    };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [reissueInvoice], pageImages: new Map() });
    // See the previous test's comment on why passenger 2 is linked MANUALLY, after passenger 1's
    // auto-link has already settled, rather than both auto-linking concurrently.
    vi.mocked(customersApi.searchCustomers).mockImplementation(async (query: string) => {
      if (query.toUpperCase() === 'JACOB') {
        return [{ id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '01-Jan-1990' }];
      }
      if (query.toUpperCase() === 'MICHAELA') {
        return [{ id: 'c2', firstName: 'Michaela', middleName: 'Rose', lastName: 'Paul', dob: '01-Jan-1990' }];
      }
      return [];
    });
    vi.mocked(bookings.listBookings).mockResolvedValue({
      bookings: [
        {
          id: 'p1', bookingDate: '2026-01-05', invoiceNumber: '0000100',
          passengerName: 'Jacob/Shibin Thomas', amount: 100, pnr: 'MHNGLM', bookingType: 'New',
        },
        {
          id: 'p2', bookingDate: '2026-01-05', invoiceNumber: '0000100',
          passengerName: 'Paul/Michaela Rose', amount: 200, pnr: 'MHNGLM', bookingType: 'New',
        },
      ],
      total: 2, page: 1, pageSize: 50,
    });
    vi.mocked(bookings.createAdjustment)
      .mockResolvedValueOnce({ id: 'a1', bookingType: 'Reissue', parentRef: 'p1', amount: 100 })
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 400, data: { error: { message: 'boom' } } },
      })
      .mockResolvedValueOnce({ id: 'a2', bookingType: 'Reissue', parentRef: 'p2', amount: 200 });
    const errorSpy = vi.spyOn(toast, 'error');
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByText('Jacob/Shibin Thomas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /select customer for passenger 2/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /search customer for passenger 2/i }), 'Michaela');
    await userEvent.click(await screen.findByText('Paul/Michaela Rose'));

    await userEvent.click(
      await screen.findByRole('combobox', { name: /original passenger for jacob\/shibin thomas/i })
    );
    await userEvent.click(await screen.findByRole('option', { name: /jacob\/shibin thomas/i }));
    await userEvent.click(
      await screen.findByRole('combobox', { name: /original passenger for paul\/michaela rose/i })
    );
    await userEvent.click(await screen.findByRole('option', { name: /paul\/michaela rose/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // p1 succeeds, p2 fails — invoice is now 'failed', p1's adjustment already exists at amount 100.
    await waitFor(() => expect(bookings.createAdjustment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());

    // The operator now edits passenger 1's amount — too late, it was already posted.
    fireEvent.change(screen.getByLabelText('Amount for passenger 1'), { target: { value: '150' } });

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // The warning must reference the passenger whose correction silently did not go through.
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('JACOB/SHIBIN THOMAS'))
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('will NOT be re-sent'));
    // p1 must still only have been posted ONCE — the warning is advisory, it does not itself
    // trigger (or block) a re-post.
    const p1Calls = vi.mocked(bookings.createAdjustment).mock.calls.filter(([parentId]) => parentId === 'p1');
    expect(p1Calls).toHaveLength(1);
  });

  // Fix round 3: a resolved parent must not survive a PNR correction. The operator resolves the
  // original passenger against the OCR'd PNR, then reads the page image, sees the OCR misread a
  // character, and corrects it — the search re-runs and correctly shows "No original booking found
  // for this PNR", but before this fix the stale id was still sitting in `parentPassengerIds`, so
  // `statusFor` still saw a resolved parent and Save stayed enabled, ready to POST the adjustment
  // against a passenger on the OLD PNR. Drives the REAL PNR field in scan-invoice-detail.tsx, not a
  // hand-fed `parentPassengerIds` — that's exactly the wiring this bug lived in.
  it('clears a resolved parent and disables Save when the PNR is corrected to no longer match', async () => {
    const reissueInvoice = { ...INVOICE, type: 'Reissue' as const, invoiceNumber: '0000970' };
    vi.mocked(scan.scanPdf).mockResolvedValue({ invoices: [reissueInvoice], pageImages: new Map() });
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([
      { id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '01-Jan-1990' },
    ]);
    // Only the ORIGINAL PNR resolves a candidate — the corrected one matches nothing, exactly the
    // "OCR misread, operator fixes a character" scenario.
    vi.mocked(bookings.listBookings).mockImplementation(async (params) => {
      if (params?.q === 'MHNGLM') {
        return {
          bookings: [
            {
              id: 'p1', bookingDate: '2026-01-05', invoiceNumber: '0000100',
              passengerName: 'Jacob/Shibin Thomas', amount: 4275.29, pnr: 'MHNGLM', bookingType: 'New',
            },
          ],
          total: 1, page: 1, pageSize: 50,
        };
      }
      return { bookings: [], total: 0, page: 1, pageSize: 50 };
    });
    renderPage();

    await userEvent.upload(
      screen.getByLabelText(/scanned invoices/i),
      new File(['x'], 'stack.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByText('Jacob/Shibin Thomas')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/original passenger resolved/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());

    // Correct a misread character in the PNR, exactly as an operator reading the page image would.
    const pnrField = screen.getByLabelText('PNR');
    await userEvent.clear(pnrField);
    await userEvent.type(pnrField, 'MHNGLN');

    // The panel must say so, AND Save must no longer be enabled against the now-stale parent.
    expect(await screen.findByText(/no original booking found/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled());

    // Belt-and-braces: even if something tried to click through, no adjustment should ever be
    // posted against the stale 'p1' after the correction.
    expect(bookings.createAdjustment).not.toHaveBeenCalled();
  });
});
