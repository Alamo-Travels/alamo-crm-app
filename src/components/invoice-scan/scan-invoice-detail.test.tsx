import { buildResolver } from '@/utils/invoiceScan/resolve';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScanInvoiceDetail, { ScanPageImage } from './scan-invoice-detail';
import { ReviewInvoice } from './reviewInvoice';
import * as customersApi from '@/api/customers.api';

vi.mock('@/api/flightData.api', () => ({ searchAirports: vi.fn().mockResolvedValue([]), searchAirlines: vi.fn().mockResolvedValue([]) }));
// ScanInvoiceDetail now renders ScanPassengerRows, whose mount-time auto-link effect (and its
// manual customer-search picker) both call searchCustomers — mocked here so these tests never
// make a real network call, matching the sibling flightData.api mock above.
vi.mock('@/api/customers.api');

beforeEach(() => {
  // This file has no global mock-reset config, so a `vi.fn()`'s call history/return value
  // persists across tests in the same file unless cleared here — the codebase's group-view-
  // persistence feature was bitten by exactly this once (see the app CLAUDE.md).
  vi.mocked(customersApi.searchCustomers).mockReset();
  vi.mocked(customersApi.searchCustomers).mockResolvedValue([]);
});

const INVOICE: ReviewInvoice = {
  id: 'scan-0', status: 'ready', pageStart: 1, pageEnd: 2, type: 'New',
  invoiceNumber: '0000243', bookingDate: '2026-07-29', pnr: 'YKHRUA',
  passengers: [{ name: 'PAUL/PHYLIEX JAMES', child: false, amount: 1740.99, ticketNumber: 'QR1', confidence: 95 }],
  segments: [], airlineName: 'QATAR AIRWAYS',
  depCityText: 'HOUSTON GEO BUSH', arrCityText: 'KOCHI',
  depDate: '2026-09-11', arrDateReturn: '2026-09-25', arrDateFinal: '2026-09-27',
  netCcBilling: 1740.99, issues: [],
  airlineCode: 'QR', depCity: 'IAH', arrCity: 'COK',
  remark: null,
  arrDateChoice: 'return', customerIds: [null], parentPassengerIds: [null], adjustmentIds: [null],
  adjustmentAmounts: [null],
  originalPnr: 'YKHRUA',
};

/**
 * Feeds `ScanInvoiceDetail`'s `onChange` output back in as its own `invoice` prop — the real
 * controlled round trip `InvoiceScanPage` drives it through, and the only way to prove the
 * Voided warning (derived straight from `invoice.type`) actually appears once the parent commits
 * the change. Also supplies the ancestor `QueryClientProvider` `CodeSearchField`'s `useQuery`
 * needs — every OTHER `CodeSearchField` consumer's test wraps its own `render()` the same way
 * (see `code-search-field.test.tsx`'s `Harness`, `booking-form.date.test.tsx`,
 * `fare-option-dialog.test.tsx`); this component relies on the app-wide client mounted in
 * `main.tsx` in production and must not carry its own.
 */
function Harness({
  initial,
  pageImages = [],
  onChange,
}: {
  initial: ReviewInvoice;
  pageImages?: ScanPageImage[];
  onChange?: (next: ReviewInvoice) => void;
}) {
  const [invoice, setInvoice] = useState(initial);
  // Fresh per harness — `buildResolver` memoises, so sharing one instance across the file would
  // carry one test's customer lookup into the next.
  const [resolver] = useState(() => buildResolver());
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScanInvoiceDetail
        invoice={invoice}
        pageImages={pageImages}
        resolver={resolver}
        onChange={(next) => {
          setInvoice(next);
          onChange?.(next);
        }}
      />
    </QueryClientProvider>
  );
}

describe('ScanInvoiceDetail', () => {
  it('shows the scanned page image so the handwriting is readable', () => {
    render(<Harness initial={INVOICE} pageImages={[{ pageNumber: 1, dataUrl: 'data:image/png;base64,X' }]} />);
    expect(screen.getByAltText(/scanned page 1/i)).toBeInTheDocument();
  });

  // A Sabre invoice routinely runs to two or three pages, and the passenger list, fare breakdown
  // and total the operator is checking against the form often sit on a LATER page than the header
  // the parser split on. Only the first page was ever shown, leaving the rest of the invoice
  // unreadable in review — the images were all present in `pageImages` the whole time.
  //
  // Pages are shown ONE at a time and stepped through with the arrows, not stacked in a scroller:
  // a scanned page at 300 dpi is far taller than the panel, so a stack means scrolling past a
  // whole page of dead space to reach the next one.
  it('shows one page at a time, starting at the first', () => {
    render(
      <Harness
        initial={INVOICE}
        pageImages={[
          { pageNumber: 1, dataUrl: 'data:image/png;base64,ONE' },
          { pageNumber: 2, dataUrl: 'data:image/png;base64,TWO' },
        ]}
      />
    );

    expect(screen.getByAltText('Scanned page 1 of 2')).toHaveAttribute('src', 'data:image/png;base64,ONE');
    expect(screen.queryByAltText('Scanned page 2 of 2')).not.toBeInTheDocument();
  });

  it('steps forward and back through the pages with the arrows', async () => {
    render(
      <Harness
        initial={INVOICE}
        pageImages={[
          { pageNumber: 1, dataUrl: 'data:image/png;base64,ONE' },
          { pageNumber: 2, dataUrl: 'data:image/png;base64,TWO' },
        ]}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByAltText('Scanned page 2 of 2')).toHaveAttribute('src', 'data:image/png;base64,TWO');
    expect(screen.queryByAltText('Scanned page 1 of 2')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /previous page/i }));
    expect(screen.getByAltText('Scanned page 1 of 2')).toHaveAttribute('src', 'data:image/png;base64,ONE');
  });

  it('disables the arrow at each end so the operator cannot step past the invoice', async () => {
    render(
      <Harness
        initial={INVOICE}
        pageImages={[
          { pageNumber: 1, dataUrl: 'data:image/png;base64,ONE' },
          { pageNumber: 2, dataUrl: 'data:image/png;base64,TWO' },
        ]}
      />
    );

    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: /next page/i }));

    expect(screen.getByRole('button', { name: /previous page/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  // Numbering restarts at 1 for EVERY invoice. The operator is correcting one invoice against one
  // physical sheet, so "Page 1 of 3" is the reading that matches what is in their hand — the
  // uploaded PDF's own continuous numbering (this invoice starting at page 4) is an artefact of
  // how the stack happened to be scanned and means nothing to them.
  it('numbers the pages within the invoice, restarting at 1 rather than continuing the PDF count', async () => {
    render(
      <Harness
        initial={{ ...INVOICE, pageStart: 4, pageEnd: 6 }}
        pageImages={[
          { pageNumber: 4, dataUrl: 'data:image/png;base64,ONE' },
          { pageNumber: 5, dataUrl: 'data:image/png;base64,TWO' },
          { pageNumber: 6, dataUrl: 'data:image/png;base64,THREE' },
        ]}
      />
    );

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.queryByText('Page 4 of 3')).not.toBeInTheDocument();
  });

  // The count comes from the invoice's own span, NOT from the position of a surviving image in the
  // array — so an unrenderable page leaves a visible hole in the sequence instead of silently
  // renumbering the pages around it and making three pages look like two.
  it('keeps the numbering aligned to the invoice span when a middle page could not be rendered', async () => {
    render(
      <Harness
        initial={{ ...INVOICE, pageStart: 4, pageEnd: 6 }}
        pageImages={[
          { pageNumber: 4, dataUrl: 'data:image/png;base64,ONE' },
          { pageNumber: 6, dataUrl: 'data:image/png;base64,THREE' },
        ]}
      />
    );

    // Stepping forward once lands on page 3 of 3, not a phantom page 2.
    await userEvent.click(screen.getByRole('button', { name: /next page/i }));

    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.queryByText('Page 2 of 3')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  it('falls back to a message when no page image could be rendered', () => {
    render(<Harness initial={INVOICE} pageImages={[]} />);
    expect(screen.getByText(/no page image available/i)).toBeInTheDocument();
  });

  // This component is NOT keyed on the invoice by its caller, so it survives an invoice switch —
  // the same hazard `ScanPassengerRows` documents at length. Left to persist, the page index would
  // point into the PREVIOUS invoice's page list: switching from page 3 of a 3-page invoice to a
  // 1-page one would render a blank panel with no way back.
  it('returns to the first page when a different invoice is selected', async () => {
    function SwitchHarness() {
      const [invoice, setInvoice] = useState(INVOICE);
      const [resolver] = useState(() => buildResolver());
      const pages =
        invoice.id === 'scan-0'
          ? [
              { pageNumber: 1, dataUrl: 'data:image/png;base64,ONE' },
              { pageNumber: 2, dataUrl: 'data:image/png;base64,TWO' },
            ]
          : [{ pageNumber: 9, dataUrl: 'data:image/png;base64,OTHER' }];
      return (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <button type="button" onClick={() => setInvoice({ ...INVOICE, id: 'scan-1', pageStart: 9, pageEnd: 9 })}>
            Switch invoice
          </button>
          <ScanInvoiceDetail invoice={invoice} pageImages={pages} resolver={resolver} onChange={setInvoice} />
        </QueryClientProvider>
      );
    }
    render(<SwitchHarness />);

    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /switch invoice/i }));

    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByAltText('Scanned page 1 of 1')).toHaveAttribute('src', 'data:image/png;base64,OTHER');
  });

  it('offers the alternative arrival date when the two candidates differ', () => {
    render(<Harness initial={INVOICE} />);
    expect(screen.getByRole('button', { name: /use 27 sep 2026/i })).toBeInTheDocument();
  });

  it('switches to the final-leg date when the alternative is chosen', async () => {
    const onChange = vi.fn();
    render(<Harness initial={INVOICE} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /use 27 sep 2026/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ arrDateChoice: 'final' }));
  });

  it('offers no alternative when both candidates are the same date', () => {
    const roundTrip = { ...INVOICE, arrDateFinal: '2026-09-25' };
    render(<Harness initial={roundTrip} />);
    expect(screen.queryByRole('button', { name: /^use /i })).not.toBeInTheDocument();
  });

  it('lets the operator change the type from the handwriting', async () => {
    const onChange = vi.fn();
    render(<Harness initial={INVOICE} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Voided' }));
    // Voiding now goes through a confirmation (final review, I4) — it destroys the scan's trip
    // data irreversibly, so it is never applied on the selection alone.
    await userEvent.click(await screen.findByRole('button', { name: /discard and mark as voided/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'Voided' }));
  });

  it('warns before voiding, because voiding discards the parsed trip and amounts — but not before', async () => {
    render(<Harness initial={INVOICE} />);

    // Absent before the operator has picked Voided — an unconditionally-rendered warning would
    // fail this half.
    expect(screen.queryByText(/only the invoice number, date and remark are kept/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Voided' }));
    await userEvent.click(await screen.findByRole('button', { name: /discard and mark as voided/i }));

    // Present once the parent has committed the change and handed back an updated `invoice` —
    // the controlled round trip the Harness exists to prove.
    expect(screen.getByText(/only the invoice number, date and remark are kept/i)).toBeInTheDocument();
  });

  // Final review, I4: selecting Voided nulled twelve fields immediately and irreversibly — switching
  // back to New left `pnr`, airline, cities and dates permanently `null`, unrecoverable without
  // re-uploading the whole PDF. The spec asked for a confirmation prompt ON the type selector; what
  // shipped was a warning rendered AFTER the destruction. One mis-click cost the whole scan.
  it('does not discard anything until the operator confirms the void', async () => {
    const onChange = vi.fn();
    render(<Harness initial={INVOICE} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Voided' }));

    // A confirmation appears and NOTHING has been committed yet.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    // The selection itself is not applied either — the Voided warning, which derives purely from
    // `invoice.type`, is still absent. (A role query cannot be used here: the confirmation is a
    // modal Radix dialog, so everything behind it is `aria-hidden` and invisible to `getByRole`.)
    expect(screen.queryByText(/only the invoice number, date and remark are kept/i)).not.toBeInTheDocument();
  });

  it('leaves the scan completely untouched when the void confirmation is cancelled', async () => {
    const onChange = vi.fn();
    render(<Harness initial={INVOICE} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Voided' }));
    await userEvent.click(await screen.findByRole('button', { name: /keep the trip details/i }));

    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('PNR')).toHaveValue('YKHRUA');
    expect(screen.getByLabelText('Airline')).toHaveValue('QR');
  });

  it('discards the trip details only once the void is explicitly confirmed', async () => {
    const onChange = vi.fn();
    render(<Harness initial={INVOICE} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Voided' }));
    await userEvent.click(await screen.findByRole('button', { name: /discard and mark as voided/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Voided', pnr: null, airlineCode: null, depCity: null, netCcBilling: null })
    );
  });

  // Nothing to lose means nothing to ask about: an invoice the parser found no trip data on (a bare
  // header, or one already voided and switched back) must not make the operator dismiss a prompt
  // about discarding data that does not exist.
  it('marks an empty invoice Voided immediately, with no confirmation to dismiss', async () => {
    const bare: ReviewInvoice = {
      ...INVOICE,
      pnr: null, segments: [], airlineName: null, airlineCode: null,
      depCityText: null, arrCityText: null, depCity: null, arrCity: null,
      depDate: null, arrDateReturn: null, arrDateFinal: null, netCcBilling: null,
    };
    const onChange = vi.fn();
    render(<Harness initial={bare} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Voided' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'Voided' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // Final review, minor: the spec says a voided invoice retains "Invoice #, Booking Date and
  // Remark", but there was no Remark control at all — so every voided invoice saved with a blank
  // remark and nothing on the ledger row said it was a void.
  it('pre-fills the remark with VOID when an invoice is confirmed voided', async () => {
    const onChange = vi.fn();
    render(<Harness initial={INVOICE} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Voided' }));
    await userEvent.click(await screen.findByRole('button', { name: /discard and mark as voided/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'Voided', remark: 'VOID' }));
    expect(screen.getByLabelText('Remark')).toHaveValue('VOID');
  });

  it('never overwrites a remark the operator already typed when voiding', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ ...INVOICE, remark: 'Cancelled by customer' }} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Voided' }));
    await userEvent.click(await screen.findByRole('button', { name: /discard and mark as voided/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ remark: 'Cancelled by customer' }));
  });

  it('lets the operator type a remark on any invoice', async () => {
    const onChange = vi.fn();
    render(<Harness initial={INVOICE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Remark'), { target: { value: 'Group booking' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ remark: 'Group booking' }));
  });

  it('lists every outstanding issue', () => {
    const flagged = { ...INVOICE, issues: ['No PNR found'], status: 'attention' as const };
    render(<Harness initial={flagged} />);
    expect(screen.getByText('No PNR found')).toBeInTheDocument();
  });

  it('renders the passenger rows for a New invoice but hides them once marked Voided', async () => {
    render(<Harness initial={INVOICE} />);
    expect(screen.getByText(/passengers/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Voided' }));
    await userEvent.click(await screen.findByRole('button', { name: /discard and mark as voided/i }));

    await waitFor(() => expect(screen.queryByText(/passengers/i)).not.toBeInTheDocument());
  });
});

// --- Fix round 1: invoice-switch regression tests -------------------------------------------
//
// Both prove the `key={invoice.id}` fix on `ScanPassengerRows`' call site in
// `scan-invoice-detail.tsx`. Before that fix, `ScanInvoiceDetail` (and the `ScanPassengerRows` it
// renders) was reused across an invoice switch with only its `invoice` prop changing — this
// Harness deliberately mirrors that exact chain (a `selected`/`onChange` round trip choosing
// between TWO invoices, matching how `InvoiceScanPage` really drives `ScanInvoiceDetail`), rather
// than testing `ScanPassengerRows` in isolation, because the bug was entirely about what its
// CALLER failed to do.

const INVOICE_A: ReviewInvoice = {
  id: 'scan-a', status: 'attention', pageStart: 1, pageEnd: 1, type: 'New',
  invoiceNumber: '1001', bookingDate: '2026-07-01', pnr: 'AAA111',
  passengers: [{ name: 'SMITH/JOHN', child: false, amount: 100, ticketNumber: 'T1', confidence: 95 }],
  segments: [], airlineName: 'QATAR AIRWAYS',
  depCityText: 'HOUSTON', arrCityText: 'KOCHI',
  depDate: '2026-09-01', arrDateReturn: '2026-09-15', arrDateFinal: '2026-09-15',
  netCcBilling: 100, issues: [],
  airlineCode: 'QR', depCity: 'IAH', arrCity: 'COK',
  remark: null,
  arrDateChoice: 'return', customerIds: [null], parentPassengerIds: [null], adjustmentIds: [null],
  adjustmentAmounts: [null],
  originalPnr: null,
};

const INVOICE_B: ReviewInvoice = {
  ...INVOICE_A,
  id: 'scan-b',
  invoiceNumber: '1002',
  pnr: 'BBB222',
  passengers: [{ name: 'KUMAR/RAVI', child: false, amount: 200, ticketNumber: 'T2', confidence: 95 }],
  customerIds: [null],
  parentPassengerIds: [null],
  adjustmentIds: [null],
  adjustmentAmounts: [null],
  originalPnr: null,
};

/** Mimics the `selectedId`/`invoices` round trip `InvoiceScanPage` actually drives
 * `ScanInvoiceDetail` through — two plain test buttons stand in for clicking a different row in
 * `ScanInvoiceList`, which is the real trigger for the bug these tests pin. */
function MultiInvoiceHarness() {
  const [invoices, setInvoices] = useState<ReviewInvoice[]>([INVOICE_A, INVOICE_B]);
  const [selectedId, setSelectedId] = useState('scan-a');
  const selected = invoices.find((inv) => inv.id === selectedId)!;
  // ONE resolver across both invoices — this harness models the page, and the page owns a single
  // instance for the whole session. Keeping it shared here is what makes these cross-invoice
  // isolation tests exercise the production arrangement rather than a per-mount stand-in.
  const [resolver] = useState(() => buildResolver());
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <button type="button" onClick={() => setSelectedId('scan-a')}>
        Select invoice A
      </button>
      <button type="button" onClick={() => setSelectedId('scan-b')}>
        Select invoice B
      </button>
      <ScanInvoiceDetail
        invoice={selected}
        pageImages={[]}
        resolver={resolver}
        onChange={(next) => setInvoices((prev) => prev.map((inv) => (inv.id === next.id ? next : inv)))}
      />
    </QueryClientProvider>
  );
}

describe('ScanInvoiceDetail — invoice-switch regressions (fix round 1)', () => {
  it('does not let a stale customer suggestion from one invoice link onto a different invoice after switching mid-search', async () => {
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([
      { id: 'doe-id', firstName: 'Jane', lastName: 'Doe', dob: '01-Jan-1990' },
    ]);
    render(<MultiInvoiceHarness />);

    // Open the search box on invoice A's passenger and type a query that resolves a real
    // suggestion in the dropdown.
    await userEvent.click(screen.getByRole('button', { name: /select customer for passenger 1/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /search customer for passenger 1/i }), 'Doe');
    const staleOption = await screen.findByText('Doe/Jane');

    // Switch to invoice B WITHOUT picking anything.
    await userEvent.click(screen.getByRole('button', { name: /select invoice b/i }));

    // The dropdown — and the whole row it belonged to — must be gone, not left floating over the
    // newly-selected invoice's passenger.
    expect(staleOption).not.toBeInTheDocument();

    // Belt and braces: even attempting the exact click that used to cause the mislink does
    // nothing now — the node is detached from the document, so it can't reach any handler.
    fireEvent.click(staleOption);
    expect(screen.getByText(/not linked — select a customer/i)).toBeInTheDocument();
  });

  it('re-runs auto-link for a newly-selected invoice, not just whichever invoice was selected at first mount', async () => {
    // This candidate ticketing-name-matches ONLY invoice B's passenger (Kumar/Ravi) — invoice A's
    // passenger (Smith/John) never resolves against it, isolating that the link happened because
    // of the switch to B, not a stale effect left over from mounting on A.
    vi.mocked(customersApi.searchCustomers).mockResolvedValue([
      { id: 'ravi-id', firstName: 'Ravi', lastName: 'Kumar', dob: '01-Jan-1985' },
    ]);
    render(<MultiInvoiceHarness />);

    await userEvent.click(screen.getByRole('button', { name: /select invoice b/i }));

    await waitFor(() => expect(screen.getByText('Kumar/Ravi')).toBeInTheDocument());
    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.queryByText(/not linked/i)).not.toBeInTheDocument();
  });
});

/**
 * Owner-reported after browser testing: payment status/type were a single page-level control
 * applied to the whole stack, but a scanned batch routinely mixes paid and pending invoices.
 * They are now per invoice, seeded from the batch control as a default.
 */
describe('per-invoice payment', () => {
  it('emits a payment status change for this invoice alone', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ ...INVOICE, paymentStatus: 'paid', paymentType: 'card' }} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Payment status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Pending' }));

    // The whole invoice is handed back with only this field changed — the type must survive, or
    // switching one control would silently reset the other.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: INVOICE.id, paymentStatus: 'pending', paymentType: 'card' })
    );
  });

  it('offers no payment controls on a Voided invoice, which records no payment at all', () => {
    render(<Harness initial={{ ...INVOICE, type: 'Voided' }} />);
    expect(screen.queryByRole('combobox', { name: 'Payment status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Payment type' })).not.toBeInTheDocument();
  });
});

describe('ScanInvoiceDetail — PNR and original-booking link', () => {
  it('carries the original-booking lookup along while it still matches the scanned PNR', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ ...INVOICE, type: 'Reissue', pnr: 'YKHRUA', originalPnr: 'YKHRUA' }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('PNR'), { target: { value: 'YKHRUB' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ pnr: 'YKHRUB', originalPnr: 'YKHRUB' })
    );
  });

  it('leaves a deliberately different original-booking lookup alone', async () => {
    const onChange = vi.fn();
    // The operator already searched out a DIFFERENT original: this reissue was ticketed on a new
    // PNR. Editing the reissue's own PNR must not destroy that link.
    render(<Harness initial={{ ...INVOICE, type: 'Reissue', pnr: 'YKHRUA', originalPnr: 'CNRAPN' }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('PNR'), { target: { value: 'YKHRUB' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ pnr: 'YKHRUB', originalPnr: 'CNRAPN' })
    );
  });
});
