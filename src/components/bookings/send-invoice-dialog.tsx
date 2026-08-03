import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateField } from '@/components/date-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label, RequiredMark } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { BookingRow, listBookings } from '@/api/bookings.api';
import { sendInvoice } from '@/api/invoices.api';
import { getBranding } from '@/api/organization.api';
import { BRANDING_QUERY_KEY, BRANDING_REFRESH_MS, useBranding } from '@/hooks/useBranding';
import { formatDisplayDate } from '@/utils/dateFormat';

interface SendInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PnrGroup {
  pnr: string;
  invoiceNumber: string;
  passengers: BookingRow[];
}

interface LineItemForm {
  description: string;
  date: string;
  qty: string;
  cost: string;
}

const EMPTY_LINE: LineItemForm = { description: '', date: '', qty: '1', cost: '' };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildLineDescription(row: BookingRow): string {
  const parts = ['Air Ticket', row.passengerName];
  if (row.pnr) parts.push(row.pnr);
  const route = [row.depCity, row.arrCity].filter(Boolean).join('→');
  const dates = [row.depDate, row.arrDate]
    .filter((d): d is string => Boolean(d))
    .map((d) => formatDisplayDate(d))
    .join(' – ');
  const trip = [route, dates].filter(Boolean).join(', ');
  if (trip) parts.push(trip);
  return parts.join(' – ');
}

export function SendInvoiceDialog({ open, onOpenChange }: SendInvoiceDialogProps) {
  const branding = useBranding();
  // Same query key as useBranding() — shares its cache entry (no extra network
  // call), just surfaces the pending state so the Terms field isn't rendered
  // with the loading fallback before the real org value has arrived.
  const brandingQuery = useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: getBranding,
    staleTime: BRANDING_REFRESH_MS,
    refetchInterval: BRANDING_REFRESH_MS,
  });

  const [pnrQuery, setPnrQuery] = useState('');
  const [debouncedPnrQuery, setDebouncedPnrQuery] = useState('');
  const [pickedPnr, setPickedPnr] = useState<string | null>(null);

  const [toEmail, setToEmail] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [billingToName, setBillingToName] = useState('');
  const [billingToLines, setBillingToLines] = useState('');
  const [lineItems, setLineItems] = useState<LineItemForm[]>([{ ...EMPTY_LINE }]);
  const [taxPct, setTaxPct] = useState('0');
  const [terms, setTerms] = useState<string | null>(null); // null = not yet user-touched, show branding value
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPnrQuery('');
    setDebouncedPnrQuery('');
    setPickedPnr(null);
    setToEmail('');
    setInvoiceNumber('');
    setInvoiceDate(todayIso());
    setBillingToName('');
    setBillingToLines('');
    setLineItems([{ ...EMPTY_LINE }]);
    setTaxPct('0');
    setTerms(null);
    setSending(false);
    setSentTo(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPnrQuery(pnrQuery), 300);
    return () => clearTimeout(t);
  }, [pnrQuery]);

  const { data: searchData } = useQuery({
    queryKey: ['bookings', 'invoice-pnr-search', debouncedPnrQuery],
    queryFn: () => listBookings({ q: debouncedPnrQuery, pageSize: 50 }),
    enabled: !pickedPnr && debouncedPnrQuery.trim().length >= 3,
  });

  // Unlike the adjustment form, ALL booking types are offered — an invoice can cover reissues/refunds.
  const pnrGroups = useMemo<PnrGroup[]>(() => {
    const rows = (searchData?.bookings ?? []).filter((r): r is BookingRow & { pnr: string } => Boolean(r.pnr));
    const byPnr = new Map<string, BookingRow[]>();
    for (const row of rows) {
      const list = byPnr.get(row.pnr) ?? [];
      list.push(row);
      byPnr.set(row.pnr, list);
    }
    return Array.from(byPnr.entries()).map(([pnr, passengers]) => ({
      pnr,
      invoiceNumber: passengers[0].invoiceNumber,
      passengers,
    }));
  }, [searchData]);

  function pickGroup(group: PnrGroup) {
    const first = group.passengers[0];
    setPickedPnr(group.pnr);
    // Reflect the chosen PNR in the search box (the query stays disabled once a group is
    // picked, so this won't retrigger a search or reopen the results list).
    setPnrQuery(group.pnr);
    setInvoiceNumber(first.invoiceNumber);
    setBillingToName(first.passengerName);
    setLineItems(
      group.passengers.map((p) => ({
        description: buildLineDescription(p),
        date: p.bookingDate.slice(0, 10),
        qty: '1',
        cost: String(p.amount),
      }))
    );
  }

  function handlePnrQueryChange(value: string) {
    setPnrQuery(value);
    if (pickedPnr) setPickedPnr(null);
  }

  function updateLine(index: number, patch: Partial<LineItemForm>) {
    setLineItems((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  const subtotal = lineItems.reduce((sum, item) => {
    const qty = Number(item.qty);
    const cost = Number(item.cost);
    return sum + (Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : 0);
  }, 0);
  const taxValue = Number(taxPct);
  const grandTotal = subtotal * (1 + (Number.isFinite(taxValue) ? taxValue : 0) / 100);

  const effectiveTerms = terms ?? branding.invoiceTerms ?? '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await sendInvoice({
        toEmail,
        invoiceNumber,
        invoiceDate,
        billingToName,
        billingToLines,
        lineItems: lineItems.map((item) => ({
          description: item.description,
          date: item.date,
          qty: Number(item.qty),
          cost: Number(item.cost),
        })),
        taxPct: Number.isFinite(taxValue) ? taxValue : 0,
        terms: effectiveTerms,
      });
      setSentTo(toEmail);
    } catch {
      setError('Could not send the invoice. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send invoice</DialogTitle>
        </DialogHeader>
        {sentTo ? (
          <div className="space-y-4">
            <p className="text-sm">Invoice sent to {sentTo}</p>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="invoice-pnr-search">Prefill from a booking (optional)</Label>
              <Input
                id="invoice-pnr-search"
                aria-label="Search PNR"
                value={pnrQuery}
                onChange={(e) => handlePnrQueryChange(e.target.value)}
                placeholder="Type at least 3 characters to search by PNR or passenger"
              />
              {!pickedPnr && pnrGroups.length > 0 && (
                <ul className="rounded-md border bg-popover text-popover-foreground shadow">
                  {pnrGroups.map((g) => (
                    <li key={g.pnr}>
                      <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => pickGroup(g)}>
                        {g.pnr} — {g.invoiceNumber} — {g.passengers.length}{' '}
                        {g.passengers.length === 1 ? 'passenger' : 'passengers'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="invoice-to-email" required>To email</Label>
              <Input
                id="invoice-to-email"
                aria-label="To email"
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="customer@example.com"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="invoice-number" required>Invoice number</Label>
                <Input
                  id="invoice-number"
                  aria-label="Invoice number"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="invoice-date" required>Invoice date</Label>
                <DateField
                  id="invoice-date"
                  ariaLabel="Invoice date"
                  value={invoiceDate}
                  onChange={setInvoiceDate}
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="invoice-billing-name" required>Billing to (name)</Label>
              <Input
                id="invoice-billing-name"
                aria-label="Billing to name"
                value={billingToName}
                onChange={(e) => setBillingToName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invoice-billing-details">Billing address / contact (optional)</Label>
              <Textarea
                id="invoice-billing-details"
                aria-label="Billing to details"
                value={billingToLines}
                onChange={(e) => setBillingToLines(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Line items<RequiredMark /></p>
              <div className="flex gap-2 text-xs font-medium text-muted-foreground">
                <span className="flex-1">Description</span>
                <span className="w-36">Date</span>
                <span className="w-16">Qty</span>
                <span className="w-24">Cost</span>
                <span className="w-[92px]" aria-hidden="true" />
              </div>
              {lineItems.map((item, index) => (
                <div key={index} className="flex items-start gap-2">
                  <Input
                    aria-label={`Line description ${index + 1}`}
                    className="flex-1"
                    value={item.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    placeholder="Description"
                    required
                  />
                  <DateField
                    ariaLabel={`Line date ${index + 1}`}
                    className="w-36"
                    value={item.date}
                    onChange={(date) => updateLine(index, { date })}
                  />
                  <Input
                    aria-label={`Line qty ${index + 1}`}
                    type="number"
                    min={1}
                    className="w-16"
                    value={item.qty}
                    onChange={(e) => updateLine(index, { qty: e.target.value })}
                    required
                  />
                  <Input
                    aria-label={`Line cost ${index + 1}`}
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-24"
                    value={item.cost}
                    onChange={(e) => updateLine(index, { cost: e.target.value })}
                    placeholder="Cost"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove line"
                    disabled={lineItems.length === 1}
                    onClick={() => setLineItems((items) => items.filter((_, i) => i !== index))}
                  >
                    Remove line
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLineItems((items) => [...items, { ...EMPTY_LINE }])}
              >
                Add line
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="invoice-tax">Tax %</Label>
              <Input
                id="invoice-tax"
                aria-label="Tax %"
                type="number"
                min={0}
                step="0.01"
                className="w-24"
                value={taxPct}
                onChange={(e) => setTaxPct(e.target.value)}
              />
              <div className="ml-auto text-right text-sm">
                <p>Subtotal: ${subtotal.toFixed(2)}</p>
                <p className="font-semibold">Grand total: ${grandTotal.toFixed(2)}</p>
              </div>
            </div>

            {!brandingQuery.isPending && (
              <div className="space-y-2">
                <Label htmlFor="invoice-terms">Terms & conditions</Label>
                <Textarea
                  id="invoice-terms"
                  aria-label="Terms & conditions"
                  value={effectiveTerms}
                  onChange={(e) => setTerms(e.target.value)}
                  rows={3}
                  placeholder="Edits apply to this invoice only"
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={sending}>
                {sending && <Spinner />}
                {sending ? 'Sending…' : 'Send invoice'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
