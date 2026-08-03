import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FUTURE_ARR_DATE, FUTURE_DEP_DATE } from '@/test-utils/dates';
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

function renderForm(initial?: BookingDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BookingForm initial={initial} onDone={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>
  );
}

/** DateField's control is a visually-hidden native `<input type="date">`; userEvent can't type
 * into it, so set it the way a date picker would. */
function pickDate(label: string, iso: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: iso } });
}

const MATCH = { id: 'c1', firstName: 'Jane', lastName: 'Smith', phone: '555-0100', dob: '02-Sep-1953' };

async function linkFirstPassenger(user: ReturnType<typeof userEvent.setup>) {
  vi.mocked(searchCustomers).mockResolvedValue([MATCH]);
  await user.type(screen.getByLabelText('Passenger name'), 'Jane');
  await user.click(await screen.findByText('Smith/Jane'));
}

/** Radix Select — `userEvent.selectOptions` does not work in this codebase; click the trigger,
 * then click the option. */
async function selectOption(user: ReturnType<typeof userEvent.setup>, comboboxName: string, optionName: string) {
  await user.click(screen.getByRole('combobox', { name: comboboxName }));
  await user.click(await screen.findByRole('option', { name: optionName }));
}

const total = () => screen.getByLabelText('Total invoice amount');

/** Set one passenger row's Payment status to Pending. Radix Select ignores userEvent.selectOptions,
 * so drive it by trigger-then-option, the pattern used across this codebase's suites. */
async function setRowPending(user: ReturnType<typeof userEvent.setup>, statusLabel: string) {
  await user.click(screen.getByRole('combobox', { name: statusLabel }));
  await user.click(await screen.findByRole('option', { name: 'Pending' }));
}

/** Two stored passengers at $450 — a $900 invoice. */
const STORED_TWO_PAX: BookingDetail = {
  booking: {
    id: 'b1',
    invoiceNumber: '000005',
    bookingDate: '2025-11-12',
    voided: false,
    pnr: 'GUDBFX',
    airlineCode: 'QR',
    depCity: 'ORD',
    arrCity: 'COK',
    depDate: '2024-03-01',
    arrDate: '2024-03-20',
  },
  passengers: [
    { id: 'p1', passengerName: 'Smith/Jane', amount: 450, customer: 'c1', payment: { status: 'paid', type: 'card', amount: 0 } },
    { id: 'p2', passengerName: 'Smith/John', amount: 450, customer: 'c2', payment: { status: 'paid', type: 'card', amount: 0 } },
  ],
};

describe('BookingForm total invoice amount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('divides a typed total across the passenger rows', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '900');

    expect(screen.getByLabelText('Amount')).toHaveValue(450);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(450);
  });

  // The rows have to add back up to the figure on screen, so the odd cents land on passenger 1.
  it('puts the leftover cents on passenger 1', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '1000');

    expect(screen.getByLabelText('Amount')).toHaveValue(333.34);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(333.33);
    expect(screen.getByLabelText('Amount 3')).toHaveValue(333.33);
  });

  it('starts blank and splits nothing on a new booking', () => {
    renderForm();
    expect(total()).toHaveValue(null);
    expect(screen.getByLabelText('Amount')).toHaveValue(null);
  });

  // The total is an authoring aid that lives in form state. It must never reach the API: the
  // Booking model has no total field and an invoice's total is the sum of its passengers.
  it('is never submitted — the payload keeps its per-passenger shape', async () => {
    const user = userEvent.setup();
    vi.mocked(createBooking).mockResolvedValue({ id: 'b9', invoiceNumber: '000005', passengers: [] });
    renderForm();

    await user.type(screen.getByLabelText('Invoice#'), '000005');
    pickDate('Booking Date', '2025-11-12');
    await user.type(screen.getByLabelText(/PNR/i), 'GUDBFX');
    await user.type(screen.getByLabelText(/Airline/i), 'QR');
    await user.type(screen.getByLabelText('Departure city'), 'ORD');
    await user.type(screen.getByLabelText('Arrival city'), 'COK');
    pickDate('Departure Date', FUTURE_DEP_DATE);
    pickDate('Arrival Date', FUTURE_ARR_DATE);
    await linkFirstPassenger(user);
    await user.type(total(), '700');
    await user.click(screen.getByRole('button', { name: /create booking/i }));

    await waitFor(() => expect(createBooking).toHaveBeenCalledTimes(1));
    const input = vi.mocked(createBooking).mock.calls[0][0];
    expect(input.passengers).toEqual([
      { passengerName: 'Smith/Jane', amount: 700, customer: 'c1', payment: { status: 'paid', type: 'card', amount: 0 } },
    ]);
    expect(input).not.toHaveProperty('totalAmount');
    expect(input).not.toHaveProperty('total');
  });

  it('EDIT: seeds the total from the stored passenger amounts, with no warning', () => {
    renderForm(STORED_TWO_PAX);
    expect(total()).toHaveValue(900);
    expect(screen.queryByText(/add up to/i)).not.toBeInTheDocument();
  });

  // The user's typed total holds its value; the rows are the truth. We tell them, we don't correct
  // them and we don't block the save.
  it('warns when a hand-edited amount stops adding up to the total', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '900');

    await user.clear(screen.getByLabelText('Amount 2'));
    await user.type(screen.getByLabelText('Amount 2'), '500');

    expect(screen.getByText(/add up to \$950\.00/)).toBeInTheDocument();
    expect(screen.getByText(/total of \$900\.00/)).toBeInTheDocument();
    // The total is unmoved and the hand-typed row is respected.
    expect(total()).toHaveValue(900);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(500);
  });

  it('warns about nothing while the total is blank', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(screen.getByLabelText('Amount'), '450');
    await user.type(screen.getByLabelText('Amount 2'), '300');

    expect(screen.queryByText(/add up to/i)).not.toBeInTheDocument();
  });

  it('does not block saving on a mismatch', async () => {
    const user = userEvent.setup();
    vi.mocked(updateBooking).mockResolvedValue(STORED_TWO_PAX);
    renderForm(STORED_TWO_PAX);

    await user.clear(screen.getByLabelText('Amount 2'));
    await user.type(screen.getByLabelText('Amount 2'), '500');
    expect(screen.getByText(/add up to \$950\.00/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateBooking).toHaveBeenCalledTimes(1));
    const input = vi.mocked(updateBooking).mock.calls[0][1];
    expect(input.passengers?.map((p) => p.amount)).toEqual([450, 500]);
  });

  it('re-splits the total when a passenger is added', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '900');
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));

    expect(total()).toHaveValue(900);
    expect(screen.getByLabelText('Amount')).toHaveValue(300);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(300);
    expect(screen.getByLabelText('Amount 3')).toHaveValue(300);
  });

  it('re-splits the total when a passenger is removed', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '900');
    await user.click(screen.getByRole('button', { name: 'Remove passenger 3' }));

    expect(total()).toHaveValue(900);
    expect(screen.getByLabelText('Amount')).toHaveValue(450);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(450);
    expect(screen.queryByLabelText('Amount 3')).not.toBeInTheDocument();
  });

  // This pins the BLANK-total guard, not the `totalTouched` ledger-safety gate — with nothing
  // typed into the total, `applyTotalSplit` returns early on its own blank check before
  // `totalTouched` is ever consulted. The EDIT test below ("adding a passenger does NOT rewrite
  // stored amounts...") is the one that actually exercises `totalTouched`.
  it('leaves the rows alone on add when no total was entered', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Amount'), '700');
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));

    expect(screen.getByLabelText('Amount')).toHaveValue(700);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(null);
  });

  // THE SILENT-MODIFICATION GUARD. The total is SEEDED on edit, so without this gate adding a
  // third passenger to a stored $900 invoice would rewrite the two saved passengers from $450 to
  // $300 each — a change to already-banked ledger figures that nobody asked for.
  it('EDIT: adding a passenger does NOT rewrite stored amounts while the seeded total is untouched', async () => {
    const user = userEvent.setup();
    renderForm(STORED_TWO_PAX);

    expect(total()).toHaveValue(900);
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));

    expect(screen.getByLabelText('Amount')).toHaveValue(450);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(450);
    expect(screen.getByLabelText('Amount 3')).toHaveValue(null);
  });

  // FINDING #1 — a re-split used to desync a hand-entered `pendingAmount` on a row the user never
  // touched. Removing a passenger RAISES the survivors' amounts; a pending row that owed its FULL
  // ticket must keep owing its full ticket, so `pendingAmount` has to follow `amount` upward or it
  // ends up understating a real outstanding balance with no warning (the amounts still reconcile
  // to the total, so the mismatch note can't catch this).
  it('per-passenger PENDING row that owed its FULL ticket: pendingAmount follows the raised amount after removing a passenger', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('checkbox', { name: /same payment & remark for all passengers/i }));
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '900');

    // Row 1 owes its whole $300 ticket.
    await selectOption(user, 'Payment status', 'Pending');
    await user.type(screen.getByLabelText('Amount owed'), '300');

    await user.click(screen.getByRole('button', { name: 'Remove passenger 3' }));

    expect(screen.getByLabelText('Amount')).toHaveValue(450);
    expect(screen.getByLabelText('Amount owed')).toHaveValue(450);
  });

  // A PARTIAL balance (a deposit already paid) is a real, hand-entered figure — it must be left
  // completely alone by a re-split, even though the ticket amount above it changes.
  it('per-passenger PENDING row with a PARTIAL balance: pendingAmount is left untouched after a re-split', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('checkbox', { name: /same payment & remark for all passengers/i }));
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '900');

    // Row 1's ticket is $300, but only $100 of it is owed — a deposit was already paid.
    await selectOption(user, 'Payment status', 'Pending');
    await user.type(screen.getByLabelText('Amount owed'), '100');

    await user.click(screen.getByRole('button', { name: 'Remove passenger 3' }));

    expect(screen.getByLabelText('Amount')).toHaveValue(450);
    expect(screen.getByLabelText('Amount owed')).toHaveValue(100);
  });

  // A PAID row has no "amount owed" concept at all — a re-split must not touch anything beyond
  // its ticket amount.
  it('a PAID (non-pending) row is unaffected by the carry-forward rule', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('checkbox', { name: /same payment & remark for all passengers/i }));
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '900');

    await user.click(screen.getByRole('button', { name: 'Remove passenger 3' }));

    expect(screen.getByLabelText('Amount')).toHaveValue(450);
    expect(screen.queryByLabelText('Amount owed')).not.toBeInTheDocument();
  });

  // The escape hatch: retyping the total is how the user opts into driving amounts from it.
  it('EDIT: retyping the total opts back into re-splitting', async () => {
    const user = userEvent.setup();
    renderForm(STORED_TWO_PAX);

    await user.clear(total());
    await user.type(total(), '1200');
    expect(screen.getByLabelText('Amount')).toHaveValue(600);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(600);

    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    expect(screen.getByLabelText('Amount')).toHaveValue(400);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(400);
    expect(screen.getByLabelText('Amount 3')).toHaveValue(400);
  });

  // Emptying the total empties what it filled in. Leaving the last split behind strands amounts the
  // user can no longer see a total for — and they'd read as hand-entered figures.
  it('clears every passenger amount when the total is cleared', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '900');
    expect(screen.getByLabelText('Amount')).toHaveValue(450);

    await user.clear(total());

    expect(total()).toHaveValue(null);
    expect(screen.getByLabelText('Amount')).toHaveValue(null);
    expect(screen.getByLabelText('Amount 2')).toHaveValue(null);
  });

  // Clearing follows the same carry-forward rule as a re-split: a balance that tracked its ticket
  // keeps tracking it, while a real deposit stays exactly where the user put it.
  it('clearing the total clears a full-ticket balance but never a partial one', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('checkbox', { name: /same payment & remark for all passengers/i }));
    await user.click(screen.getByRole('button', { name: 'Add passenger' }));
    await user.type(total(), '900');
    await setRowPending(user, 'Payment status');
    await setRowPending(user, 'Payment status 2');
    await user.type(screen.getByLabelText('Amount owed'), '450'); // owes the whole ticket
    await user.type(screen.getByLabelText('Amount owed 2'), '200'); // paid a deposit

    await user.clear(total());

    expect(screen.getByLabelText('Amount')).toHaveValue(null);
    expect(screen.getByLabelText('Amount owed')).toHaveValue(null);
    expect(screen.getByLabelText('Amount owed 2')).toHaveValue(200);
  });

  it('floors every money field at zero — total, per-passenger amount, and amount owed', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(total()).toHaveAttribute('min', '0');
    expect(screen.getByLabelText('Amount')).toHaveAttribute('min', '0');

    await user.click(screen.getByRole('checkbox', { name: /same payment & remark for all passengers/i }));
    await setRowPending(user, 'Payment status');
    expect(screen.getByLabelText('Amount owed')).toHaveAttribute('min', '0');
  });
});
