import { FormEvent, ReactNode, useMemo, useState } from 'react';
import { Hash, Plane, PlaneLanding, PlaneTakeoff, StickyNote, Ticket, User, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label, RequiredMark } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { BookingDetail, createBooking, DuplicateInvoice, updateBooking, UpdateBookingInput, UpdatePassengerInput } from '@/api/bookings.api';
import { searchCustomers } from '@/api/customers.api';
import { AddEditCustomerDialog } from '@/components/customers/add-edit-customer-dialog';
import { CodeSearchField } from '@/components/code-search-field';
import { DateField } from '@/components/date-field';
import { IconInput } from '@/components/icon-input';
import { searchAirports, searchAirlines } from '@/api/flightData.api';
import { useListNavigation } from '@/hooks/useListNavigation';
import { duplicateInvoice, errorMessage } from '@/utils/apiError';
import { formatUsd, splitAmount } from '@/utils/amountSplit';
import { formatDisplayDate } from '@/utils/dateFormat';
import { ticketingName } from '@/utils/ticketingName';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { canCreateCustomers } from '@/utils/permissions';

const emptyForm = {
  invoiceNumber: '',
  bookingDate: new Date().toISOString().slice(0, 10),
  voided: false,
  pnr: '',
  airlineCode: '',
  depCity: '',
  arrCity: '',
  depDate: '',
  arrDate: '',
};

interface PassengerRow {
  /** Present only for a passenger already stored on the invoice. A row the user just added has
   * no id, which is exactly how the backend tells "create" from "update" in its diff. */
  id?: string;
  name: string;
  amount: string;
  customer?: string;
  paymentStatus: 'paid' | 'pending';
  paymentType: 'card' | 'check' | 'cash';
  pendingAmount: string;
  // Never rendered — this row has no "paid on" control. It only exists so an existing passenger's
  // `payment.paidOn` (set via record-payment-dialog.tsx) survives a wholesale `PATCH /bookings/:id`,
  // which replaces each submitted passenger's `payment` as a whole object — any field this form
  // doesn't send is erased server-side. On a brand-new row there is nothing to preserve, so this
  // stays '' and is never submitted (see handleSubmit).
  paidOn: string;
  remark: string;
}

const EMPTY_PASSENGER: PassengerRow = {
  name: '',
  amount: '',
  paymentStatus: 'paid',
  paymentType: 'card',
  pendingAmount: '',
  paidOn: '',
  remark: '',
};

function formStateFrom(initial?: BookingDetail): typeof emptyForm {
  if (!initial) return emptyForm;
  const b = initial.booking;
  return {
    invoiceNumber: b.invoiceNumber,
    bookingDate: b.bookingDate,
    voided: b.voided,
    pnr: b.pnr ?? '',
    airlineCode: b.airlineCode ?? '',
    depCity: b.depCity ?? '',
    arrCity: b.arrCity ?? '',
    depDate: b.depDate ?? '',
    arrDate: b.arrDate ?? '',
  };
}

function passengerRowsFrom(initial?: BookingDetail): PassengerRow[] {
  if (!initial || initial.passengers.length === 0) return [{ ...EMPTY_PASSENGER }];
  return initial.passengers.map((p) => ({
    id: p.id,
    name: p.passengerName,
    amount: String(p.amount),
    customer: p.customer,
    paymentStatus: p.payment?.status ?? 'paid',
    paymentType: p.payment?.type ?? 'card',
    // `!= null` (not truthy) so a pending payment stored with amount 0 still seeds '0', not ''
    // into this `required` input.
    pendingAmount: p.payment?.amount != null ? String(p.payment.amount) : '',
    paidOn: p.payment?.paidOn ?? '',
    remark: p.remark ?? '',
  }));
}

/** The invoice total shown when an existing booking is opened: the sum of its stored passenger
 * amounts, in cents so the arithmetic can't drift. Blank for a new booking. */
function totalAmountFrom(initial?: BookingDetail): string {
  if (!initial || initial.passengers.length === 0) return '';
  const cents = initial.passengers.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
  return String(cents / 100);
}

/** The single payment+remark applied to every passenger when the "same for all" checkbox is on. */
interface SharedPayment {
  paymentStatus: 'paid' | 'pending';
  paymentType: 'card' | 'check' | 'cash';
  // Invisible round-trip, same reason as PassengerRow.paidOn: preserve a stored paidOn through a
  // wholesale PATCH. Seeded from passenger 1; shared mode only defaults on when every passenger's
  // paidOn is already identical, so there is nothing to lose by collapsing to one.
  paidOn: string;
  remark: string;
}

function sharedStateFrom(initial?: BookingDetail): SharedPayment {
  const p = initial?.passengers[0];
  return {
    paymentStatus: p?.payment?.status ?? 'paid',
    paymentType: p?.payment?.type ?? 'card',
    paidOn: p?.payment?.paidOn ?? '',
    remark: p?.remark ?? '',
  };
}

/**
 * Whether the dialog opens in shared mode (the "same payment & remark for all passengers" checkbox
 * checked). A NEW booking always does. An EXISTING one does only when every passenger already
 * carries the same status / type / paidOn / remark AND is either all paid or all
 * pending-owing-its-OWN-full-ticket — the only pending shape shared mode can represent, since it
 * has no per-passenger "amount owed" field. Any real difference (mixed status/type/remark, a
 * partial balance, differing paid-on) opens per-passenger, so nothing is silently flattened on save.
 */
function isShareable(initial?: BookingDetail): boolean {
  if (!initial || initial.passengers.length === 0) return true;
  const first = initial.passengers[0];
  const status = (p: BookingDetail['passengers'][number]) => p.payment?.status ?? 'paid';
  const type = (p: BookingDetail['passengers'][number]) => p.payment?.type ?? 'card';
  const paidOn = (p: BookingDetail['passengers'][number]) => p.payment?.paidOn ?? '';
  const remark = (p: BookingDetail['passengers'][number]) => p.remark ?? '';
  // A pending passenger is shareable only if it owes its own full ticket amount.
  const pendingOwesFullTicket = (p: BookingDetail['passengers'][number]) =>
    status(p) !== 'pending' || (p.payment?.amount ?? 0) === p.amount;
  return initial.passengers.every(
    (p) =>
      status(p) === status(first) &&
      type(p) === type(first) &&
      paidOn(p) === paidOn(first) &&
      remark(p) === remark(first) &&
      pendingOwesFullTicket(p)
  );
}

interface BookingFormProps {
  /** Absent = create a new booking. Present = edit this one. */
  initial?: BookingDetail;
  /** Rendered into the form's first grid cell. The create dialog passes its Booking Type
   * <Select> here; the edit dialog passes nothing (a New booking can't become a Reissue). */
  typeSelector?: ReactNode;
  onDone: () => void;
  onCancel: () => void;
}

export function BookingForm({ initial, typeSelector, onDone, onCancel }: BookingFormProps) {
  const user = useAuthStore((s) => s.user);
  const canAddCustomer = canCreateCustomers(user);
  // No reset-on-`initial`-change effect here on purpose: `initial` comes from a TanStack Query in
  // the edit dialog, and this form's own `onSuccess` invalidates ['bookings'] — a background
  // refetch mid-edit would hand this component a new `initial` object identity and (if an effect
  // watched it) silently wipe whatever the user had typed. Both callers instead remount this
  // component on open/close (`EditBookingDialog` keys it by `data.booking.id`, `CreateBookingDialog`
  // keys it by `open ? 'open' : 'closed'`), so these lazy initializers already re-seed correctly
  // without any effect. (This exact class of bug was fixed once already in this codebase — see
  // send-quote-dialog.tsx's `wasOpen`-gated reset effect — so don't reintroduce it here.)
  const [form, setForm] = useState(() => formStateFrom(initial));
  const [passengers, setPassengers] = useState<PassengerRow[]>(() => passengerRowsFrom(initial));
  // "Same payment & remark for all passengers." On (default for a new or all-identical booking) =>
  // one shared payment/remark block; off => per-passenger fields. Seeded by isShareable in a lazy
  // initializer (never a reset effect — the dialog remounts per record, see the note below).
  const [shareAll, setShareAll] = useState(() => isShareable(initial));
  const [shared, setShared] = useState<SharedPayment>(() => sharedStateFrom(initial));
  // Invoice total — an AUTHORING CONVENIENCE ONLY. It is never submitted and never stored; a
  // Booking has no total field and an invoice's total is the sum of its passengers' amounts, both
  // before and after this feature. Typing here divides the figure across the rows.
  const [totalAmount, setTotalAmount] = useState(() => totalAmountFrom(initial));
  // Whether the user has actually TYPED a total this session. A total merely seeded from a stored
  // invoice must not drive anything (see the add/remove handlers) — otherwise adding a passenger
  // to a saved invoice would silently rewrite its other passengers' stored amounts.
  const [totalTouched, setTotalTouched] = useState(false);
  // Which passenger row's autocomplete is active, and what it has typed.
  const [search, setSearch] = useState<{ index: number; query: string } | null>(null);
  // Which passenger row an inline "add new customer" should fill on success.
  const [addCustomerIndex, setAddCustomerIndex] = useState(0);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  // The payload the backend warned about, held so "Save anyway" can re-send exactly it with
  // confirmDuplicate set. Non-null iff the warning panel is showing.
  const [pendingDuplicate, setPendingDuplicate] = useState<{ input: UpdateBookingInput; duplicate: DuplicateInvoice } | null>(null);
  // True once the user has tried to submit with an unlinked passenger — drives the inline
  // "pick a customer" message. Every non-voided passenger must be tied to a Customer record.
  const [linkAttempted, setLinkAttempted] = useState(false);
  // Passengers that were ALREADY stored unlinked when this form opened — historic rows, typically
  // bulk-imported from the old spreadsheet, whose real-world passenger may have no Customer record
  // at all. They are grandfathered past the link gate: linking is mandatory for anything NEW, but
  // requiring it here would mean a years-old invoice couldn't be edited (to fix a PNR, say) without
  // first inventing a customer for it. Computed once from `initial` — the component is remounted per
  // record (see the note above), so this can't go stale.
  const grandfathered = useMemo(
    () => new Set((initial?.passengers ?? []).filter((p) => !p.customer).map((p) => p.id)),
    [initial]
  );

  /** Whether a row must be linked before this form can be saved. A grandfathered row is exempt only
   * while it still holds its stored name — clearing the name (via ✕, or on a row the user blanked)
   * means they're re-entering the passenger, and re-entered data follows the new-data rule. */
  function needsCustomer(p: PassengerRow): boolean {
    if (p.customer) return false;
    if (p.id && grandfathered.has(p.id) && p.name.trim().length > 0) return false;
    return true;
  }

  // Derived during render, deliberately NOT state — there is nothing to keep in sync and no effect
  // involved. Compared in integer cents so ordinary decimal amounts can't produce a phantom
  // mismatch. A blank or unparseable total means "no total entered", not zero.
  const totalCents = totalAmount.trim() === '' ? null : Math.round(Number(totalAmount) * 100);
  const rowCents = passengers.reduce((sum, p) => sum + Math.round((Number(p.amount) || 0) * 100), 0);
  const totalMismatch =
    totalCents !== null && Number.isFinite(totalCents) && totalCents !== rowCents
      ? { rows: formatUsd(rowCents / 100), total: formatUsd(totalCents / 100) }
      : null;

  // Departure/Arrival dates are NOT floored at today — old invoices are routinely entered after the
  // flight has already happened, so a past trip date is legitimate on create just as it is on edit.
  // The one bound kept is that Arrival can't precede its own Departure, and only on create (a
  // historic invoice may hold data that violates even that, and must stay correctable). `bookingDate`
  // is likewise unbounded — back-dating the ledger entry itself is a legitimate action.
  const minArrDate = initial ? undefined : form.depDate || undefined;

  const queryClient = useQueryClient();

  const searchQuery = search?.query ?? '';
  const { data: matches = [] } = useQuery({
    queryKey: ['customers', 'search', searchQuery],
    queryFn: () => searchCustomers(searchQuery),
    enabled: searchQuery.trim().length >= 3,
  });

  const saveMutation = useMutation({
    mutationFn: async (input: UpdateBookingInput): Promise<void> => {
      if (initial) {
        await updateBooking(initial.booking.id, input);
      } else {
        await createBooking(input);
      }
    },
    onMutate: () => setPendingDuplicate(null),
    onError: (err, input) => {
      const duplicate = duplicateInvoice(err);
      if (duplicate) setPendingDuplicate({ input, duplicate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      onDone();
      toast.success(initial ? 'Booking updated' : 'Booking created');
    },
  });

  function updatePassenger(index: number, patch: Partial<PassengerRow>) {
    setPassengers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /** Apply a computed per-row split, carrying a FULL-ticket pending balance forward onto the new
   * `amount` — a passenger who owed their whole ticket keeps owing their whole ticket after a
   * re-split (e.g. removing a passenger raises the survivors' amounts). A PARTIAL balance (a real,
   * hand-entered deposit already paid) is a genuine figure and is left completely untouched — this
   * function only ever writes `pendingAmount` when it was already tracking `amount` exactly.
   * Comparison runs in integer cents, never floats, matching the rest of this feature. Pure — no
   * closure over reactive state — so both call sites below can share it safely. */
  function withSplitAmounts(rows: PassengerRow[], split: string[]): PassengerRow[] {
    return rows.map((row, i) => {
      const amount = split[i] ?? row.amount;
      const owedFullTicket =
        row.paymentStatus === 'pending' &&
        Math.round((Number(row.pendingAmount) || 0) * 100) === Math.round((Number(row.amount) || 0) * 100);
      return { ...row, amount, ...(owedFullTicket ? { pendingAmount: amount } : {}) };
    });
  }

  /** Typing in the total re-divides it across every row, live. Splitting inside the updater (rather
   * than closing over `passengers`) keeps it correct if a row was added in the same tick. */
  function handleTotalChange(value: string) {
    setTotalAmount(value);
    setTotalTouched(true);
    // Emptying the total empties what it filled in. Leaving the last split behind would strand
    // amounts the user can no longer see a total for, and they'd read as hand-entered figures.
    // Routed through withSplitAmounts so a full-ticket pending balance clears with its ticket
    // while a real deposit stays put — the same carry-forward rule a re-split follows.
    if (value.trim() === '') {
      setPassengers((rows) => withSplitAmounts(rows, rows.map(() => '')));
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setPassengers((rows) => withSplitAmounts(rows, splitAmount(parsed, rows.length)));
  }

  /** Re-divide the entered total across `rows`.
   *
   * A no-op unless the user has actually TYPED a total. On edit the field is seeded from the
   * invoice's stored amounts, and re-splitting off a seeded value would silently rewrite saved
   * passenger amounts the moment someone added a row — retyping the total is the opt-in. */
  function applyTotalSplit(rows: PassengerRow[]): PassengerRow[] {
    const parsed = Number(totalAmount);
    if (!totalTouched || totalAmount.trim() === '' || !Number.isFinite(parsed)) return rows;
    return withSplitAmounts(rows, splitAmount(parsed, rows.length));
  }

  function selectMatch(index: number, name: string, customerId: string) {
    updatePassenger(index, { name, customer: customerId });
    setSearch(null);
  }

  /** The suggestion list is open for a row when that row is the one being searched and the
   * query is long enough — the same condition that renders it. */
  function isNameListOpen(index: number): boolean {
    return search?.index === index && search.query.trim().length >= 3;
  }

  const {
    activeIndex: nameActiveIndex,
    setActiveIndex: setNameActiveIndex,
    handleKeyDown: handleNameKeyDown,
  } = useListNavigation({
    items: matches,
    onSelect: (m) => {
      if (search) selectMatch(search.index, ticketingName(m), m.id);
    },
    onClose: () => setSearch(null),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    // Every non-voided passenger must be linked to a Customer (picked from autocomplete or
    // inline-created). The name control never accepts hand-typed final values, so an unlinked row
    // here means the user never picked (or re-picked) anyone — EXCEPT a grandfathered historic row,
    // which stays saveable as-is (see `needsCustomer`).
    if (!form.voided && passengers.some(needsCustomer)) {
      setLinkAttempted(true);
      return;
    }

    // Rows that will actually be submitted (a blank never-typed row is dropped; a stored row is
    // always kept). Voided invoices don't render passengers and submit a placeholder instead.
    const storedRows = passengers.filter((p) => Boolean(p.id) || p.name.trim().length > 0);

    saveMutation.mutate({
      invoiceNumber: form.invoiceNumber,
      bookingDate: form.bookingDate,
      voided: form.voided,
      pnr: form.voided ? undefined : form.pnr || undefined,
      airlineCode: form.voided ? undefined : form.airlineCode || undefined,
      depCity: form.voided ? undefined : form.depCity || undefined,
      arrCity: form.voided ? undefined : form.arrCity || undefined,
      depDate: form.voided ? undefined : form.depDate || undefined,
      arrDate: form.voided ? undefined : form.arrDate || undefined,
      // A voided invoice hides the Passengers section, but the `VOID` placeholder is CREATE-only
      // (`!initial`): the backend requires >=1 passenger on every booking, and a brand-new voided
      // invoice has no stored passengers yet, so it needs a dummy row to satisfy that. It carries no
      // payment — a voided placeholder is just a name+amount stand-in, nothing was ever paid on it.
      // In EDIT mode there ARE stored passengers, and `PATCH /bookings/:id` treats `passengers[]` as
      // the complete desired end state — a stored passenger omitted from the array is DELETED, and
      // an entry with no `id` is indistinguishable from "start fresh". Submitting the id-less VOID
      // placeholder here would delete every real passenger on the invoice. `voided` only relaxes
      // the backend's pnr/airlineCode requirement; it does not require a dummy passenger, so in
      // edit mode we send the stored rows with their ids (and their own payment/remark), exactly
      // like the non-voided path — don't collapse these two branches back together.
      passengers:
        form.voided && !initial
          ? [{ passengerName: 'VOID', amount: 0 }]
          : storedRows.map<UpdatePassengerInput>((p) => {
              // In shared mode every passenger takes the one shared payment/remark; otherwise each
              // takes its own row values.
              const status = shareAll ? shared.paymentStatus : p.paymentStatus;
              const type = shareAll ? shared.paymentType : p.paymentType;
              const remark = shareAll ? shared.remark : p.remark;
              const paidOn = shareAll ? shared.paidOn : p.paidOn;
              // Paid => owes 0. Pending: shared mode has no amount field, so each passenger owes its
              // OWN full ticket amount (cap-safe: owed == own amount); per-passenger mode uses the
              // row's entered "amount owed".
              const owed = status !== 'pending' ? 0 : shareAll ? Number(p.amount) : Number(p.pendingAmount);
              return {
                // A row with no id is a passenger the user just added — the backend creates it.
                ...(p.id ? { id: p.id } : {}),
                passengerName: p.name,
                amount: Number(p.amount),
                ...(p.customer ? { customer: p.customer } : {}),
                remark: remark || undefined,
                payment: {
                  status,
                  type,
                  amount: owed,
                  // Round-tripped invisibly (no "paid on" control here). On CREATE it is always ''
                  // => undefined => absent, matching prior behavior. On a stored row/edit it carries
                  // through whatever record-payment-dialog.tsx set, so saving an unrelated field
                  // doesn't erase it via the wholesale PATCH.
                  paidOn: paidOn || undefined,
                },
              };
            }),
    });
  }

  /** Toggle the shared-payment checkbox. Checking adopts passenger 1's payment/remark as the shared
   * values (applied to everyone on save). Unchecking seeds every passenger row from the shared
   * values (all rows start identical; the user then differentiates) — a pending row is seeded with
   * its OWN full ticket amount, matching what shared mode would have submitted. */
  function toggleShareAll(checked: boolean) {
    if (checked) {
      const first = passengers[0];
      setShared({
        paymentStatus: first.paymentStatus,
        paymentType: first.paymentType,
        paidOn: first.paidOn,
        remark: first.remark,
      });
    } else {
      setPassengers((rows) =>
        rows.map((row) => ({
          ...row,
          paymentStatus: shared.paymentStatus,
          paymentType: shared.paymentType,
          paidOn: shared.paidOn,
          remark: shared.remark,
          pendingAmount: shared.paymentStatus === 'pending' ? row.amount : row.pendingAmount,
        }))
      );
    }
    setShareAll(checked);
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Row: Booking Type | Invoice# | Booking Date | Mark as voided — the create dialog passes a
          typeSelector for the first cell; the edit dialog passes none (a New booking can't become a
          Reissue), so that cell is dropped entirely and the grid collapses by one column rather than
          leaving a blank leading column.

          Booking Date defaults to today but MUST be editable: an invoice is routinely entered days
          after it was raised, and the ledger is largely back-filled historical data. It is also the
          field the duplicate-invoice warning keys on (invoice# + booking date + PNR), so leaving it
          silently pinned to today — as this form did until 2026-07-13 — both mis-dates the row and
          skews that check. */}
      <div className={cn('grid items-end gap-3', typeSelector ? 'grid-cols-4' : 'grid-cols-3')}>
        {typeSelector && <div className="space-y-1">{typeSelector}</div>}
        <div className="space-y-1">
          <Label htmlFor="booking-invoice-number" required>Invoice#</Label>
          <IconInput
            id="booking-invoice-number"
            aria-label="Invoice number"
            icon={<Hash />}
            value={form.invoiceNumber}
            onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
            placeholder="e.g. 1042"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="booking-date" required>Booking Date</Label>
          <DateField
            id="booking-date"
            ariaLabel="Booking Date"
            value={form.bookingDate}
            onChange={(iso) => setForm({ ...form, bookingDate: iso })}
            required
          />
        </div>
        <div className="flex items-center gap-2 pb-2.5">
          <Checkbox
            id="booking-voided"
            checked={form.voided}
            onCheckedChange={(checked) => setForm({ ...form, voided: checked === true })}
          />
          <Label htmlFor="booking-voided">Mark as voided</Label>
        </div>
      </div>

      {/* Passengers: one row per passenger — hidden entirely when voided (a placeholder
          VOID passenger is submitted instead, since the backend requires ≥1 passenger). */}
      {!form.voided && (
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Passengers<RequiredMark /></p>
          <div className="flex items-center gap-2">
            <Checkbox
              id="booking-share-payment"
              checked={shareAll}
              onCheckedChange={(checked) => toggleShareAll(checked === true)}
            />
            <Label htmlFor="booking-share-payment" className="font-normal">
              Same payment &amp; remark for all passengers
            </Label>
          </div>
        </div>
        {/* Invoice total: divides across the passenger rows as you type, leftover cents to
            passenger 1. Each row stays individually editable — editing one by hand does NOT move
            this value, it raises the mismatch note instead. Optional: leaving it blank splits
            nothing and every row behaves as it did before this existed. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="booking-total-amount" className="text-xs font-normal text-muted-foreground">
              Total invoice amount
            </Label>
            <div className="relative w-40">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground">
                $
              </span>
              <Input
                id="booking-total-amount"
                aria-label="Total invoice amount"
                type="number"
                min="0"
                className="h-9 pl-6"
                value={totalAmount}
                onChange={(e) => handleTotalChange(e.target.value)}
                placeholder="Splits across PAXs"
              />
            </div>
          </div>
          {totalMismatch && (
            <p className="pb-2 text-sm text-amber-600 dark:text-amber-500">
              Passenger amounts add up to {totalMismatch.rows}, which doesn&apos;t match the total of{' '}
              {totalMismatch.total}.
            </p>
          )}
        </div>
        {passengers.map((passenger, index) => {
          const nameLabel = index === 0 ? 'Passenger name' : `Passenger name ${index + 1}`;
          const searching = search?.index === index;
          const mode: 'search' | 'selected' | 'unlinked' = searching
            ? 'search'
            : passenger.customer
              ? 'selected'
              : passenger.name.trim().length > 0
                ? 'unlinked'
                : 'search';
          const paymentStatusLabel = index === 0 ? 'Payment status' : `Payment status ${index + 1}`;
          const paymentTypeLabel = index === 0 ? 'Payment type' : `Payment type ${index + 1}`;
          const pendingAmountLabel = index === 0 ? 'Amount owed' : `Amount owed ${index + 1}`;
          const remarkLabel = index === 0 ? 'Remark' : `Remark ${index + 1}`;
          return (
          <div key={index} className="space-y-2 rounded-md border p-2">
          <div className="flex items-start gap-2">
            <div className="relative flex-1">
              {mode === 'selected' && (
                <div className="flex items-center gap-2">
                  <IconInput aria-label={nameLabel} icon={<User />} value={passenger.name} readOnly />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Change customer for passenger ${index + 1}`}
                    className="h-9 w-9 shrink-0"
                    onClick={() => {
                      updatePassenger(index, { name: '', customer: undefined });
                      setSearch({ index, query: '' });
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {mode === 'unlinked' && (
                <div className="space-y-1">
                  <IconInput aria-label={nameLabel} icon={<User />} value={passenger.name} readOnly />
                  <div className="flex items-center gap-2">
                    {/* Muted, not destructive, for a grandfathered row: it is saveable as-is, so
                        colouring it like a blocking error would be a lie. Linking is still offered. */}
                    <p className={needsCustomer(passenger) ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                      Not linked{needsCustomer(passenger) ? ' — select a customer' : ' (historic entry)'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Select customer for passenger ${index + 1}`}
                      onClick={() => setSearch({ index, query: '' })}
                    >
                      Select customer
                    </Button>
                  </div>
                </div>
              )}
              {mode === 'search' && (
                <>
                  <IconInput
                    aria-label={nameLabel}
                    icon={<User />}
                    value={searching ? search.query : ''}
                    onChange={(e) => setSearch({ index, query: e.target.value })}
                    onKeyDown={searching ? handleNameKeyDown : undefined}
                    placeholder="Search customer (3+ letters)"
                    role="combobox"
                    aria-expanded={isNameListOpen(index)}
                    aria-controls={`passenger-listbox-${index}`}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      isNameListOpen(index) && nameActiveIndex >= 0
                        ? `passenger-listbox-${index}-${nameActiveIndex}`
                        : undefined
                    }
                  />
                  {/* A historic (originally-unlinked) row keeps its stored name in state while the
                      user re-searches; surface it so they know who to match. A ✕-cleared selected
                      row has name '' here, so this only shows for the historic case. */}
                  {searching && !passenger.customer && passenger.name.trim().length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">Originally recorded as {passenger.name}</p>
                  )}
                  {linkAttempted && needsCustomer(passenger) && (
                    <p role="alert" className="mt-1 text-sm text-destructive">
                      Select a customer from the list, or add a new one.
                    </p>
                  )}
                  {isNameListOpen(index) && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border bg-popover text-popover-foreground shadow">
                      {/* "+ Add new customer" pinned above the (scrollable) matches so it never sinks
                          below a long result list; max-h-48 ≈ 6 rows visible, the rest scroll.
                          Gated on customers.create — it opens the Add-Customer dialog, so that's the
                          permission it needs, not a bookings one. Searching/selecting an EXISTING
                          customer below is unaffected and stays available to everyone. */}
                      {canAddCustomer && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start border-b font-medium"
                          onClick={() => {
                            setAddCustomerIndex(index);
                            setAddCustomerOpen(true);
                          }}
                        >
                          + Add new customer
                        </Button>
                      )}
                      {matches.length > 0 && (
                        <ul id={`passenger-listbox-${index}`} role="listbox" className="max-h-48 overflow-y-auto">
                          {matches.map((m, matchIndex) => (
                            <li
                              key={m.id}
                              id={`passenger-listbox-${index}-${matchIndex}`}
                              role="option"
                              aria-selected={matchIndex === nameActiveIndex}
                              className={cn('cursor-pointer px-3 py-1', matchIndex === nameActiveIndex && 'bg-accent')}
                              onMouseEnter={() => setNameActiveIndex(matchIndex)}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => selectMatch(index, ticketingName(m), m.id)}
                            >
                              <div>{ticketingName(m)}</div>
                              <div className="text-xs text-muted-foreground">{m.dob}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="relative w-32 shrink-0">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground">
                $
              </span>
              <Input
                aria-label={index === 0 ? 'Amount' : `Amount ${index + 1}`}
                type="number"
                min="0"
                className="pl-6"
                value={passenger.amount}
                onChange={(e) => updatePassenger(index, { amount: e.target.value })}
                placeholder="Amount"
                required
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove passenger ${index + 1}`}
              disabled={passengers.length === 1}
              className="h-9 w-9 shrink-0 rounded-md bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-700 disabled:bg-muted disabled:text-muted-foreground dark:bg-red-950 dark:text-red-300"
              onClick={() => setPassengers((rows) => applyTotalSplit(rows.filter((_, i) => i !== index)))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {/* Row: Payment Status | Payment Type (Paid only) / Amount owed (Pending only) | Remark —
              per-passenger, rendered only when NOT sharing one payment/remark across all passengers
              (see the shared block below). */}
          {!shareAll && (
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-3 space-y-1">
              <Label className="text-xs font-normal text-muted-foreground">{paymentStatusLabel}</Label>
              <Select
                value={passenger.paymentStatus}
                onValueChange={(v) => updatePassenger(index, { paymentStatus: v as 'paid' | 'pending' })}
              >
                <SelectTrigger aria-label={paymentStatusLabel} className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {passenger.paymentStatus === 'paid' && (
              <div className="col-span-3 space-y-1">
                <Label className="text-xs font-normal text-muted-foreground">{paymentTypeLabel}</Label>
                <Select
                  value={passenger.paymentType}
                  onValueChange={(v) => updatePassenger(index, { paymentType: v as 'card' | 'check' | 'cash' })}
                >
                  <SelectTrigger aria-label={paymentTypeLabel} className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {passenger.paymentStatus === 'pending' && (
              <div className="col-span-3 space-y-1">
                <Label htmlFor={`passenger-pending-amount-${index}`} required className="text-xs font-normal">
                  {pendingAmountLabel}
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground">
                    $
                  </span>
                  <Input
                    id={`passenger-pending-amount-${index}`}
                    aria-label={pendingAmountLabel}
                    type="number"
                    min="0"
                    className="h-9 pl-6"
                    value={passenger.pendingAmount}
                    onChange={(e) => updatePassenger(index, { pendingAmount: e.target.value })}
                    required
                  />
                </div>
              </div>
            )}
            <div className="col-span-6 space-y-1">
              <Label htmlFor={`passenger-remark-${index}`} className="text-xs font-normal text-muted-foreground">
                {remarkLabel}
              </Label>
              <IconInput
                id={`passenger-remark-${index}`}
                aria-label={remarkLabel}
                icon={<StickyNote />}
                value={passenger.remark}
                onChange={(e) => updatePassenger(index, { remark: e.target.value })}
                placeholder="Optional note"
              />
            </div>
          </div>
          )}
          </div>
          );
        })}
        {/* Add passenger sits directly under the passenger rows (above the payment controls). */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              // Reset the submit-attempt flag so a fresh blank row doesn't inherit the red
              // "Select a customer" alert from a previous failed submit before it's even been used.
              setLinkAttempted(false);
              setPassengers((rows) => applyTotalSplit([...rows, { ...EMPTY_PASSENGER }]));
            }}
          >
            Add passenger
          </Button>
        </div>
        {/* Shared payment/remark: one block applied to every passenger. Pending has NO amount field
            here — each passenger owes its own full ticket amount (see handleSubmit). */}
        {shareAll && (
          <div className="grid grid-cols-12 gap-2 rounded-md border p-2">
            <div className="col-span-3 space-y-1">
              <Label className="text-xs font-normal text-muted-foreground">Payment status</Label>
              <Select
                value={shared.paymentStatus}
                onValueChange={(v) => setShared({ ...shared, paymentStatus: v as 'paid' | 'pending' })}
              >
                <SelectTrigger aria-label="Payment status" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {shared.paymentStatus === 'paid' && (
              <div className="col-span-3 space-y-1">
                <Label className="text-xs font-normal text-muted-foreground">Payment type</Label>
                <Select
                  value={shared.paymentType}
                  onValueChange={(v) => setShared({ ...shared, paymentType: v as 'card' | 'check' | 'cash' })}
                >
                  <SelectTrigger aria-label="Payment type" className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={cn('space-y-1', shared.paymentStatus === 'paid' ? 'col-span-6' : 'col-span-9')}>
              <Label htmlFor="booking-shared-remark" className="text-xs font-normal text-muted-foreground">
                Remark
              </Label>
              <IconInput
                id="booking-shared-remark"
                aria-label="Remark"
                icon={<StickyNote />}
                value={shared.remark}
                onChange={(e) => setShared({ ...shared, remark: e.target.value })}
                placeholder="Optional note"
              />
            </div>
            {shared.paymentStatus === 'pending' && (
              <p className="col-span-12 text-xs text-muted-foreground">
                Each passenger owes their full ticket amount.
              </p>
            )}
          </div>
        )}
      </div>
      )}

      {/* Row: PNR | Airline Code (hidden when voided) */}
      {!form.voided && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="booking-pnr" required>PNR</Label>
            <IconInput
              id="booking-pnr"
              aria-label="PNR"
              icon={<Ticket />}
              value={form.pnr}
              onChange={(e) => setForm({ ...form, pnr: e.target.value })}
              placeholder="e.g. X4F2QP"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="booking-airline" required>Airline Code</Label>
            <CodeSearchField
              id="booking-airline"
              ariaLabel="Airline code"
              value={form.airlineCode}
              onChange={(airlineCode) => setForm({ ...form, airlineCode })}
              search={searchAirlines}
              queryKey="airlines"
              placeholder="e.g. Qatar or QR"
              icon={<Plane />}
              required
            />
          </div>
        </div>
      )}

      {!form.voided && (
        <>
          {/* Row: Departure City | Arrival City */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="booking-dep-city" required>Departure City</Label>
              <CodeSearchField
                id="booking-dep-city"
                ariaLabel="Departure city"
                value={form.depCity}
                onChange={(depCity) => setForm({ ...form, depCity })}
                search={searchAirports}
                queryKey="airports"
                placeholder="e.g. Houston or IAH"
                icon={<PlaneTakeoff />}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="booking-arr-city" required>Arrival City</Label>
              <CodeSearchField
                id="booking-arr-city"
                ariaLabel="Arrival city"
                value={form.arrCity}
                onChange={(arrCity) => setForm({ ...form, arrCity })}
                search={searchAirports}
                queryKey="airports"
                placeholder="e.g. Kochi or COK"
                icon={<PlaneLanding />}
                required
              />
            </div>
          </div>

          {/* Row: Departure Date | Arrival Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="booking-dep-date" required>Departure Date</Label>
              <DateField
                id="booking-dep-date"
                ariaLabel="Departure Date"
                value={form.depDate}
                onChange={(iso) => setForm({ ...form, depDate: iso })}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="booking-arr-date" required>Arrival Date</Label>
              <DateField
                id="booking-arr-date"
                ariaLabel="Arrival Date"
                value={form.arrDate}
                onChange={(iso) => setForm({ ...form, arrDate: iso })}
                required
                minDate={minArrDate}
              />
            </div>
          </div>
        </>
      )}

      {pendingDuplicate && (
        <div className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <p className="font-medium">
            Invoice {pendingDuplicate.duplicate.invoiceNumber} already exists with the same date and PNR.
          </p>
          <p className="mt-1 text-muted-foreground">
            {formatDisplayDate(pendingDuplicate.duplicate.bookingDate)}
            {pendingDuplicate.duplicate.pnr ? ` · ${pendingDuplicate.duplicate.pnr}` : ''}
            {pendingDuplicate.duplicate.passengerNames.length > 0
              ? ` · ${pendingDuplicate.duplicate.passengerNames.join(', ')}`
              : ''}
          </p>
          <p className="mt-2">Is this a different invoice?</p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPendingDuplicate(null);
                // Also clears saveMutation's own error state, not just the panel above — without
                // this the generic error line re-renders right underneath with the SAME "already
                // exists" text the panel just showed, once `pendingDuplicate` goes back to null.
                saveMutation.reset();
              }}
            >
              Go back
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate({ ...pendingDuplicate.input, confirmDuplicate: true })}
            >
              {saveMutation.isPending && <Spinner />}
              Save anyway
            </Button>
          </div>
        </div>
      )}
      {saveMutation.isError && !pendingDuplicate && (
        <p className="text-sm text-destructive">
          {errorMessage(saveMutation.error, 'Save failed. Check your connection and try again.')}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Spinner />}
          {saveMutation.isPending ? 'Saving…' : initial ? 'Save changes' : 'Create booking'}
        </Button>
      </DialogFooter>
    </form>
    <AddEditCustomerDialog
      open={addCustomerOpen}
      onOpenChange={setAddCustomerOpen}
      onCreated={(fullName, customerId) => {
        updatePassenger(addCustomerIndex, { name: fullName, customer: customerId });
        setSearch(null);
      }}
    />
    </>
  );
}
