import { buildResolver } from '@/utils/invoiceScan/resolve';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScanPassengerRows from './scan-passenger-rows';
import { ReviewInvoice } from './reviewInvoice';
import * as customers from '@/api/customers.api';

vi.mock('@/api/customers.api');

const INVOICE: ReviewInvoice = {
  id: 'scan-0', status: 'attention', pageStart: 1, pageEnd: 1, type: 'New',
  invoiceNumber: '0000249', bookingDate: '2026-07-31', pnr: 'MHNGLM',
  passengers: [
    { name: 'JACOB/SHIBIN THOMAS', child: false, amount: 4275.29, ticketNumber: 'EY1', confidence: 96 },
    { name: 'PAUL/MICHAELA ROSE', child: true, amount: 1500.51, ticketNumber: 'EY2', confidence: 96 },
  ],
  segments: [], airlineName: 'ETIHAD AIRWAYS',
  depCityText: 'ATLANTA', arrCityText: 'KOCHI',
  depDate: '2026-11-05', arrDateReturn: '2026-11-26', arrDateFinal: '2026-11-26',
  netCcBilling: 5775.80, issues: [],
  airlineCode: 'EY', depCity: 'ATL', arrCity: 'COK',
  remark: null,
  arrDateChoice: 'return', customerIds: [null, null], parentPassengerIds: [null, null],
  adjustmentIds: [null, null], adjustmentAmounts: [null, null],
};

/** The same invoice carrying a $30 service charge printed separately from the ticket fares, so the
 *  passenger amounts (5,775.80) legitimately fall short of the printed total (5,805.80). */
const SERVICE_CHARGE_INVOICE: ReviewInvoice = { ...INVOICE, netCcBilling: 5805.8 };

beforeEach(() => {
  vi.mocked(customers.searchCustomers).mockReset();
  vi.mocked(customers.searchCustomers).mockResolvedValue([]);
});

/**
 * Feeds `ScanPassengerRows`' `onChange` output back in as its own `invoice` prop — the real
 * controlled round trip `ScanInvoiceDetail`/`InvoiceScanPage` drive it through, and the only way
 * to prove a multi-keystroke edit actually lands (rather than fighting a `value` prop the test
 * never updates). Also supplies the ancestor `QueryClientProvider` this component's own
 * `useQuery` (customer search) and the nested `AddEditCustomerDialog`'s `useMutation` both need —
 * every other `QueryClientProvider`-needing consumer's test wraps its own `render()` the same way
 * (see `scan-invoice-detail.test.tsx`'s `Harness`, `code-search-field.test.tsx`'s `Harness`); this
 * component relies on the app-wide client mounted in `main.tsx` in production and must not carry
 * its own.
 */
function Harness({ initial, onChange }: { initial: ReviewInvoice; onChange?: (next: ReviewInvoice) => void }) {
  const [invoice, setInvoice] = useState(initial);
  // A FRESH resolver per harness, not one shared across the file: `buildResolver` memoises, so a
  // single instance would carry one test's customer lookup into the next. In production the page
  // owns one instance for the whole session — that is the point of the prop — but per-test
  // isolation matters more here, and this mirrors the per-mount lifetime these tests already had.
  const [resolver] = useState(() => buildResolver());
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScanPassengerRows
        invoice={invoice}
        resolver={resolver}
        onChange={(next) => {
          setInvoice(next);
          onChange?.(next);
        }}
      />
    </QueryClientProvider>
  );
}

describe('ScanPassengerRows', () => {
  it('renders a row per scanned passenger with its own amount', () => {
    render(<Harness initial={INVOICE} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('4275.29')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1500.51')).toBeInTheDocument();
  });

  // The invoice's own printed NET CC BILLING was parsed all along (it gates the batch save via
  // `reconciles`) but was never shown, so the operator had no reference to reconcile the
  // per-passenger amounts against — and the scan-time issue text that reported a mismatch is a
  // FROZEN snapshot that never updates as they edit.
  it('shows the invoice total beside the live sum of the passenger amounts', () => {
    render(<Harness initial={INVOICE} onChange={vi.fn()} />);
    expect(screen.getByText('Passenger amounts').parentElement).toHaveTextContent('$5,775.80');
    expect(screen.getByText(/invoice total/i).parentElement).toHaveTextContent('$5,775.80');
  });

  // The case this exists for: a service charge printed separately on the invoice, so the ticket
  // amounts legitimately fall short of the total and the operator has to spread it across the
  // passengers by hand.
  it('reports how much of the invoice total is not yet on any passenger', () => {
    render(<Harness initial={SERVICE_CHARGE_INVOICE} onChange={vi.fn()} />);
    expect(screen.getByText(/\$30\.00 of the invoice total/i)).toBeInTheDocument();
  });

  it('shrinks the shortfall live as the operator spreads the charge across the passengers', async () => {
    render(<Harness initial={SERVICE_CHARGE_INVOICE} onChange={vi.fn()} />);

    const first = screen.getByLabelText('Amount for passenger 1');
    await userEvent.clear(first);
    await userEvent.type(first, '4290.29');

    expect(screen.getByText(/\$15\.00 of the invoice total/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$30\.00 of the invoice total/i)).not.toBeInTheDocument();
  });

  it('says nothing about a shortfall once the amounts reach the total', async () => {
    render(<Harness initial={SERVICE_CHARGE_INVOICE} onChange={vi.fn()} />);

    const first = screen.getByLabelText('Amount for passenger 1');
    await userEvent.clear(first);
    await userEvent.type(first, '4305.29');

    expect(screen.queryByText(/of the invoice total/i)).not.toBeInTheDocument();
  });

  it('flags amounts that overshoot the invoice total', async () => {
    render(<Harness initial={INVOICE} onChange={vi.fn()} />);

    const first = screen.getByLabelText('Amount for passenger 1');
    await userEvent.clear(first);
    await userEvent.type(first, '4295.29');

    expect(screen.getByText(/\$20\.00 more than the invoice total/i)).toBeInTheDocument();
  });

  // A total OCR could not read is null, not zero — claiming the whole invoice is unallocated would
  // be a fabricated mismatch on an invoice that may be perfectly correct.
  it('does not invent a mismatch when the invoice total could not be read', () => {
    render(<Harness initial={{ ...INVOICE, netCcBilling: null }} onChange={vi.fn()} />);
    expect(screen.getByText(/invoice total/i).parentElement).toHaveTextContent(/not read/i);
    expect(screen.queryByText(/of the invoice total/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/more than the invoice total/i)).not.toBeInTheDocument();
  });

  it('auto-links a passenger when exactly one customer matches', async () => {
    vi.mocked(customers.searchCustomers).mockResolvedValue([
      { id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '02-Sep-1953' },
    ]);
    const onChange = vi.fn();
    render(<Harness initial={INVOICE} onChange={onChange} />);

    // Exact array, not `arrayContaining` — the candidate only ticketing-name-matches passenger 1
    // (Jacob/Shibin Thomas), so the fix must land the id at index 0 specifically, leaving index 1
    // untouched. `arrayContaining` would pass just as happily on an index-swapped bug.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ customerIds: ['c1', null] }))
    );
  });

  it('shows the scanned name and prompts for a customer when nothing matched', async () => {
    render(<Harness initial={INVOICE} onChange={vi.fn()} />);
    expect(await screen.findAllByText(/select a customer/i)).toHaveLength(2);
  });

  it('marks a child passenger so the reviewer can pick the right person', () => {
    render(<Harness initial={INVOICE} onChange={vi.fn()} />);
    expect(screen.getByText(/child/i)).toBeInTheDocument();
  });

  it('lets the operator correct an amount', async () => {
    const onChange = vi.fn();
    render(<Harness initial={INVOICE} onChange={onChange} />);

    const amount = screen.getByDisplayValue('4275.29');
    await userEvent.clear(amount);
    await userEvent.type(amount, '99');

    // Assert the actual payload, not just that onChange fired — a version that wrote to the
    // wrong row, or dropped the typed value entirely, would still satisfy a bare
    // `toHaveBeenCalled()`. The Harness feeds each keystroke's onChange back into `invoice`, so
    // the field is genuinely controlled and the final call reflects the real edit.
    function lastCall(): ReviewInvoice {
      const calls = onChange.mock.calls;
      return calls[calls.length - 1][0] as ReviewInvoice;
    }
    await waitFor(() => {
      expect(lastCall().passengers[0].amount).toBe(99);
    });
    // Passenger 2's amount must be untouched — proves the edit didn't bleed into the wrong row.
    expect(lastCall().passengers[1].amount).toBe(1500.51);
  });
});
