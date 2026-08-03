import { buildResolver } from '@/utils/invoiceScan/resolve';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScanInvoiceDetail from './scan-invoice-detail';
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
  pageImage,
  onChange,
}: {
  initial: ReviewInvoice;
  pageImage?: string;
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
        pageImage={pageImage}
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
    render(<Harness initial={INVOICE} pageImage="data:image/png;base64,X" />);
    expect(screen.getByAltText(/scanned page 1/i)).toBeInTheDocument();
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
        pageImage={undefined}
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
