import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconInput } from '@/components/icon-input';
import { Input } from '@/components/ui/input';
import { RequiredMark } from '@/components/ui/label';
import { AddEditCustomerDialog } from '@/components/customers/add-edit-customer-dialog';
import { CustomerSearchResult, searchCustomers } from '@/api/customers.api';
import type { ScanResolver } from '@/utils/invoiceScan/resolve';
import { ticketingName } from '@/utils/ticketingName';
import { useAuthStore } from '@/stores/authStore';
import { canCreateCustomers } from '@/utils/permissions';
import { formatUsd } from '@/utils/amountSplit';
import { ReviewInvoice, passengerAmountTotal, reconciles } from './reviewInvoice';

interface ScanPassengerRowsProps {
  invoice: ReviewInvoice;
  onChange: (next: ReviewInvoice) => void;
  /**
   * The PAGE's resolver, shared across the whole review session — deliberately not built here.
   * This component is keyed on `invoice.id`, so it remounts on every invoice switch; building a
   * resolver in the effect gave each mount a fresh, empty memo cache and re-issued the same
   * customer lookups every time the operator moved between invoices. The spec's batch
   * de-duplication only holds if one cache spans the batch.
   */
  resolver: ScanResolver;
}

/** How a row got its Customer link — cosmetic only (drives the "Matched" vs "Linked" label);
 *  both are equally valid links. Not persisted on `invoice`, which stores only the id. */
interface LinkedDisplay {
  name: string;
  source: 'auto' | 'manual';
}

/**
 * Passenger rows for one scanned invoice: the OCR'd name (fixed — it is what the operator matches
 * against), a customer picker, and an editable amount (OCR misreads amounts roughly one in six
 * times, so it is the field most likely to need a fix).
 *
 * Every non-Voided passenger must resolve to a real Customer before saving, with NO grandfathering
 * exemption unlike booking-form.tsx: every row here is freshly read off a scan, not a years-old
 * ledger entry.
 *
 * MUST be keyed on `invoice.id` by its caller. This owns real per-invoice state (which row is
 * searching, resolved matches, the display-name cache), so reusing the instance across an invoice
 * switch points that state at the wrong invoice: auto-link stops firing after the first, and a
 * suggestion opened on one invoice can link onto another's passenger. Found and closed the hard
 * way; do not remove the key as redundant.
 *
 * Relies on an ancestor `QueryClientProvider` for its customer search and the nested
 * `AddEditCustomerDialog`.
 */
export default function ScanPassengerRows({ invoice, onChange, resolver }: ScanPassengerRowsProps) {
  const user = useAuthStore((s) => s.user);
  const canAddCustomer = canCreateCustomers(user);

  const [linked, setLinked] = useState<Record<number, LinkedDisplay>>({});
  // Which row's search box is open (null = none), and what it has typed. Only one row searches
  // at a time.
  const [searchIndex, setSearchIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [addCustomerIndex, setAddCustomerIndex] = useState(0);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);

  // "Latest" refs so the mount-only auto-link effect below can merge into whatever `invoice`/
  // `onChange` are CURRENT when each lookup resolves, not whatever they were at mount time.
  // Several lookups race concurrently (one per passenger); without this, a later resolution would
  // merge into a stale (pre-update) copy of `customerIds` and silently overwrite an earlier
  // resolution's freshly-set id back to null.
  const invoiceRef = useRef(invoice);
  invoiceRef.current = invoice;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Auto-link, once per mount. Passenger names are read-only here, so nothing about this list
  // ever changes after mount in a way that should re-trigger resolution — running this again on
  // every amount edit would repeat the same lookups for no benefit and risks clobbering a link
  // the operator has since changed by hand.
  useEffect(() => {
    let cancelled = false;
    invoice.passengers.forEach((passenger, index) => {
      if (invoiceRef.current.customerIds[index]) return; // already linked when this mounted
      resolver.customer(passenger.name).then((match) => {
        if (cancelled || !match) return;
        setLinked((prev) => ({ ...prev, [index]: { name: ticketingName(match), source: 'auto' } }));
        const current = invoiceRef.current;
        onChangeRef.current({
          ...current,
          customerIds: current.customerIds.map((id, i) => (i === index ? match.id : id)),
        });
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The active row's search results, via TanStack Query — mirrors CodeSearchField/booking-form's
  // picker (caches/dedups across rows and cancels a stale in-flight request itself). No debounce:
  // this is a manual fallback path used only when auto-link failed to find a unique match, not a
  // keystroke-heavy primary input.
  const { data: matches = [] } = useQuery({
    queryKey: ['customers', 'search', searchQuery],
    queryFn: () => searchCustomers(searchQuery),
    enabled: searchIndex !== null && searchQuery.trim().length >= 3,
  });

  function openSearch(index: number) {
    setSearchIndex(index);
    setSearchQuery('');
  }

  function linkCustomer(index: number, customer: CustomerSearchResult, source: 'auto' | 'manual') {
    setLinked((prev) => ({ ...prev, [index]: { name: ticketingName(customer), source } }));
    onChange({ ...invoice, customerIds: invoice.customerIds.map((id, i) => (i === index ? customer.id : id)) });
    setSearchIndex(null);
  }

  function unlinkCustomer(index: number) {
    setLinked((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    onChange({ ...invoice, customerIds: invoice.customerIds.map((id, i) => (i === index ? null : id)) });
    openSearch(index);
  }

  const amountsTotal = passengerAmountTotal(invoice.passengers);
  // Split into two one-sided values rather than a signed difference so each renders its own
  // sentence. Both are null when the amounts agree with the total — or when the total could not
  // be read at all, since `reconciles` treats an absent total as nothing to reconcile against
  // (reporting the whole invoice as unallocated there would be a fabricated mismatch).
  const difference = reconciles(invoice) || invoice.netCcBilling === null ? 0 : invoice.netCcBilling - amountsTotal;
  const shortfall = difference > 0 ? difference : null;
  const overshoot = difference < 0 ? -difference : null;

  function updateAmount(index: number, raw: string) {
    const amount = raw.trim() === '' ? null : Number(raw);
    onChange({
      ...invoice,
      passengers: invoice.passengers.map((p, i) =>
        i === index ? { ...p, amount: Number.isNaN(amount) ? p.amount : amount } : p
      ),
    });
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">
        Passengers
        <RequiredMark />
      </p>
      {invoice.passengers.map((passenger, index) => {
        const customerId = invoice.customerIds[index];
        const searching = searchIndex === index;
        const info = linked[index];
        const nameLabel = `Passenger ${index + 1} name`;

        return (
          <div key={index} className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <IconInput icon={<User />} aria-label={nameLabel} value={passenger.name} readOnly />
              </div>
              {passenger.child && (
                <Badge variant="secondary" className="shrink-0 text-muted-foreground">
                  Child
                </Badge>
              )}
            </div>

            {customerId ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{info?.source === 'auto' ? 'Matched' : 'Linked'}</Badge>
                <span className="text-sm">{info?.name ?? 'Customer linked'}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Change customer for passenger ${index + 1}`}
                  className="h-8 w-8 shrink-0"
                  onClick={() => unlinkCustomer(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : searching ? (
              <div className="relative">
                <IconInput
                  icon={<User />}
                  aria-label={`Search customer for passenger ${index + 1}`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search customer (3+ letters)"
                />
                {searchQuery.trim().length >= 3 && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border bg-popover text-popover-foreground shadow">
                    {/* Gated on customers.create — this opens the Add-Customer dialog, so that's
                        the permission it needs. Searching/picking an EXISTING customer stays
                        available to everyone below. */}
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
                      <ul role="listbox" className="max-h-48 overflow-y-auto">
                        {matches.map((m) => (
                          <li
                            key={m.id}
                            role="option"
                            className="cursor-pointer px-3 py-1"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => linkCustomer(index, m, 'manual')}
                          >
                            <div>{ticketingName(m)}</div>
                            <div className="text-xs text-muted-foreground">{m.dob}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-sm text-destructive">Not linked — select a customer</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Select customer for passenger ${index + 1}`}
                  onClick={() => openSearch(index)}
                >
                  Select customer
                </Button>
              </div>
            )}

            <div className="relative w-32">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground">
                $
              </span>
              <Input
                aria-label={`Amount for passenger ${index + 1}`}
                type="number"
                step="0.01"
                className="pl-6"
                value={passenger.amount ?? ''}
                onChange={(e) => updateAmount(index, e.target.value)}
              />
            </div>
          </div>
        );
      })}

      {/* The invoice's own printed total, purely as a REFERENCE to reconcile the amounts against —
          it is never submitted and never stored (the per-passenger amounts are what get saved).
          It exists because a real invoice often prints a service charge separately from the ticket
          fares, so the amounts OCR reads off the ticket blocks legitimately fall short of the
          total and the operator has to spread the difference across the passengers by hand.
          Without the total on screen there was nothing to spread it against: the only report of a
          mismatch was the scan-time `issues` text, which is a frozen snapshot that keeps quoting
          the original figures no matter what the operator corrects. */}
      <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Passenger amounts</span>
          <span className="font-medium">{formatUsd(amountsTotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Invoice total (NET CC BILLING)</span>
          <span className="font-medium">
            {invoice.netCcBilling === null ? 'Not read from the scan' : formatUsd(invoice.netCcBilling)}
          </span>
        </div>
        {shortfall !== null && (
          <p className="text-amber-600 dark:text-amber-500">
            {formatUsd(shortfall)} of the invoice total is not on any passenger yet.
          </p>
        )}
        {overshoot !== null && (
          <p className="text-amber-600 dark:text-amber-500">
            Passenger amounts are {formatUsd(overshoot)} more than the invoice total.
          </p>
        )}
      </div>

      <AddEditCustomerDialog
        open={addCustomerOpen}
        onOpenChange={setAddCustomerOpen}
        onCreated={(fullName, customerId) => {
          setLinked((prev) => ({ ...prev, [addCustomerIndex]: { name: fullName, source: 'manual' } }));
          onChange({
            ...invoice,
            customerIds: invoice.customerIds.map((id, i) => (i === addCustomerIndex ? customerId : id)),
          });
          setSearchIndex(null);
        }}
      />
    </div>
  );
}
