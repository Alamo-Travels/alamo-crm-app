import { useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Hash, Plane, PlaneLanding, PlaneTakeoff, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IconInput } from '@/components/icon-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CodeSearchField } from '@/components/code-search-field';
import { DateField } from '@/components/date-field';
import { searchAirlines, searchAirports } from '@/api/flightData.api';
import { formatDisplayDate } from '@/utils/dateFormat';
import { ScannedInvoiceType } from '@/utils/invoiceScan/types';
import type { ScanResolver } from '@/utils/invoiceScan/resolve';
import { useAuthStore } from '@/stores/authStore';
import { canCreateAdjustments } from '@/utils/permissions';
import { ReviewInvoice } from './reviewInvoice';
import ScanAdjustmentParent from './scan-adjustment-parent';
import ScanPassengerRows from './scan-passenger-rows';

/**
 * Edits the scanned PNR, carrying `originalPnr` along with it WHILE THE TWO STILL AGREE.
 *
 * The two fields are deliberately separate (see `ReviewInvoice.originalPnr`): `pnr` is what gets
 * POSTed on the adjustment, `originalPnr` is only which booking to attach it to. But they are
 * seeded identically and are the same value on the overwhelmingly common reissue, so an operator
 * correcting an OCR misread here plainly means both — leaving `originalPnr` behind would keep
 * looking the parent up under the character they just fixed.
 *
 * Once the operator has deliberately pointed `originalPnr` somewhere else (a reissue ticketed
 * under a NEW PNR), the two no longer agree and this stops touching it — otherwise editing the
 * new PNR would silently destroy the original link they went to the trouble of searching for.
 */
function withPnr(invoice: ReviewInvoice, pnr: string): ReviewInvoice {
  const linked = invoice.originalPnr === invoice.pnr;
  return { ...invoice, pnr, originalPnr: linked ? pnr : invoice.originalPnr };
}

/** One rendered page of the uploaded PDF, carrying its own 1-based page number. */
export interface ScanPageImage {
  pageNumber: number;
  dataUrl: string;
}

/**
 * One page of the invoice at a time, stepped through with the arrows.
 *
 * Deliberately a pager rather than a scrolling stack: a page rendered at 300 dpi is several times
 * taller than the panel, so stacking them means scrolling through a whole page of dead space to
 * reach the next one, with no indication of how many are left.
 *
 * Owns the only piece of local state in this file's subtree, which is why it is a separate
 * component — its caller remounts it per invoice via `key`, and that remount is what resets the
 * page index (see the call site).
 */
function ScanPageViewer({
  pages,
  pageStart,
  pageCount,
}: {
  pages: ScanPageImage[];
  pageStart: number;
  pageCount: number;
}) {
  const [index, setIndex] = useState(0);

  if (pages.length === 0) {
    return (
      <div className="flex items-start justify-center rounded-md border bg-muted/30 p-2">
        <p className="py-8 text-center text-sm text-muted-foreground">No page image available.</p>
      </div>
    );
  }

  const page = pages[index];
  // Numbered WITHIN this invoice, restarting at 1 for each one — the operator is correcting a
  // single invoice against a single physical sheet, and the uploaded PDF's continuous count (this
  // invoice happening to start at page 14 of the stack) tells them nothing. Derived from the
  // invoice's own span rather than the position in `pages`, so an unrenderable page leaves a
  // VISIBLE gap in the sequence (1 then 3 of 3) instead of silently renumbering the survivors and
  // making a lost page look like a page that was never there.
  const numberInInvoice = page.pageNumber - pageStart + 1;

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      {/* Rendered even for a single-page invoice, both arrows disabled: the label is the
          operator's confirmation that there is nothing else to look at. */}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Previous page"
          className="h-8 w-8 shrink-0"
          disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-xs text-muted-foreground">
          Page {numberInInvoice} of {pageCount}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Next page"
          className="h-8 w-8 shrink-0"
          disabled={index === pages.length - 1}
          onClick={() => setIndex((i) => i + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <img
        src={page.dataUrl}
        alt={`Scanned page ${numberInInvoice} of ${pageCount}`}
        className="max-h-[70vh] w-full object-contain"
      />
    </div>
  );
}

interface ScanInvoiceDetailProps {
  invoice: ReviewInvoice;
  /**
   * EVERY page this invoice spans (`pageStart`…`pageEnd`), in order — not just the first.
   *
   * A Sabre invoice routinely runs to two or three pages, and the passenger list, fare breakdown
   * and totals the operator is checking against the form frequently sit on a LATER page than the
   * header the parser split on; showing only page one left the rest of the invoice unreadable
   * during review. A page that failed to render is simply absent from this array (it is never a
   * placeholder), which is why each entry carries its OWN `pageNumber` rather than the caption
   * being derived from the array index — with page 4 of 4–6 unrenderable, the remaining images
   * must still be labelled 5 and 6.
   */
  pageImages: ScanPageImage[];
  onChange: (next: ReviewInvoice) => void;
  /** Passed straight through to `ScanPassengerRows` — see its prop doc for why the resolver is
   *  owned by the page and not built per mount. */
  resolver: ScanResolver;
}

/**
 * The detail panel for one scanned invoice: the page image beside an editable form. Fully
 * controlled and stateless — every field, including the "you're about to discard this invoice's
 * trip data" Voided warning, is derived straight from `invoice`; every edit calls `onChange` with
 * a new `ReviewInvoice` and the component keeps no copy of anything itself. Relies on an
 * ANCESTOR `QueryClientProvider` for `CodeSearchField`'s airline/airport search (the app-wide one
 * mounted in `main.tsx` in production; each test wraps its own `render()` the same way every
 * other `CodeSearchField` consumer's tests do — see `code-search-field.test.tsx`'s `Harness`).
 */
export default function ScanInvoiceDetail({ invoice, pageImages, onChange, resolver }: ScanInvoiceDetailProps) {
  const user = useAuthStore((s) => s.user);
  const allowAdjustments = canCreateAdjustments(user);

  // Which arrival-date candidate is currently shown/edited, and which is the other one a
  // one-click swap would switch to. Real invoices often end with a domestic leg days after the
  // international return, so the parser computes both; when they agree there's nothing to decide.
  const activeArrDate = invoice.arrDateChoice === 'return' ? invoice.arrDateReturn : invoice.arrDateFinal;
  const otherArrDate = invoice.arrDateChoice === 'return' ? invoice.arrDateFinal : invoice.arrDateReturn;
  const showArrAlternative = Boolean(invoice.arrDateReturn) && Boolean(invoice.arrDateFinal) && invoice.arrDateReturn !== invoice.arrDateFinal;

  /** How many pages this invoice SPANS — not how many rendered. A page that failed to render is
   *  missing from `pageImages` but is still one of the invoice's pages, and saying "of 2" when the
   *  operator is looking at pages 1 and 3 of 3 would hide that something was lost. */
  const pageCount = invoice.pageEnd - invoice.pageStart + 1;

  /**
   * The id of the invoice a void confirmation is currently open for, or `null`.
   *
   * This is the component's ONLY piece of local state and it is deliberately UI-transient, not data
   * — no field value is mirrored here (that was the `voidWarningVisible` mistake an earlier fix
   * removed; the Voided warning below is still a pure derivation from `invoice.type`). Storing the
   * TARGET ID rather than a boolean is what keeps the "holds nothing about a specific invoice"
   * property honest: the dialog's `open` is `voidTargetId === invoice.id`, so switching the selected
   * invoice while a confirmation is up simply closes it, and the confirm handler can only ever act
   * on the invoice it was opened for. (`InvoiceScanPage` renders this component unkeyed, so it IS
   * reused across a switch — see the `ScanPassengerRows` key comment below for how that has bitten
   * this file before.)
   */
  const [voidTargetId, setVoidTargetId] = useState<string | null>(null);

  /** Whether marking this invoice Voided would actually throw parsed data away. */
  const hasTripDataToDiscard = Boolean(
    invoice.pnr ||
      invoice.segments.length > 0 ||
      invoice.airlineName ||
      invoice.airlineCode ||
      invoice.depCityText ||
      invoice.arrCityText ||
      invoice.depCity ||
      invoice.arrCity ||
      invoice.depDate ||
      invoice.arrDateReturn ||
      invoice.arrDateFinal ||
      invoice.netCcBilling !== null
  );

  function applyVoid() {
    // The ledger records a voided invoice as nothing but its invoice number, date and remark —
    // discard everything else the parser read so the form doesn't keep showing trip details
    // that will never be saved.
    onChange({
      ...invoice,
      type: 'Voided',
      pnr: null,
      segments: [],
      airlineName: null,
      airlineCode: null,
      depCityText: null,
      arrCityText: null,
      depCity: null,
      arrCity: null,
      depDate: null,
      arrDateReturn: null,
      arrDateFinal: null,
      netCcBilling: null,
      // A voided invoice is recorded as nothing but its number, date and REMARK, so a blank remark
      // leaves the ledger row with nothing at all saying it was a void. Pre-fill the conventional
      // 'VOID' — but never over an operator's own words, which are strictly more informative.
      remark: invoice.remark?.trim() ? invoice.remark : 'VOID',
    });
    setVoidTargetId(null);
  }

  function handleTypeChange(value: string) {
    const type = value as ScannedInvoiceType;
    if (type !== 'Voided') {
      onChange({ ...invoice, type });
      return;
    }
    // Nothing to lose — apply straight away rather than making the operator dismiss a prompt about
    // discarding data that does not exist (a bare header, or an invoice already reduced by a
    // previous void).
    if (!hasTripDataToDiscard) {
      applyVoid();
      return;
    }
    setVoidTargetId(invoice.id);
  }

  function toggleArrDateChoice() {
    onChange({ ...invoice, arrDateChoice: invoice.arrDateChoice === 'return' ? 'final' : 'return' });
  }

  function setArrDate(iso: string) {
    const patch = invoice.arrDateChoice === 'return' ? { arrDateReturn: iso || null } : { arrDateFinal: iso || null };
    onChange({ ...invoice, ...patch });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Keyed on the invoice so the page index re-seeds to the first page on every switch — this
          component is NOT keyed by its caller, so a reset effect would be the alternative, and
          this codebase prefers a key-based remount (see `ScanPassengerRows`' own key warning and
          the booking-edit notes in CLAUDE.md). */}
      <ScanPageViewer key={invoice.id} pages={pageImages} pageStart={invoice.pageStart} pageCount={pageCount} />

      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="scan-type">Type</Label>
          <Select value={invoice.type} onValueChange={handleTypeChange}>
            <SelectTrigger id="scan-type" aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="New">New</SelectItem>
              <SelectItem value="Voided">Voided</SelectItem>
              {allowAdjustments && <SelectItem value="Reissue">Reissue</SelectItem>}
              {allowAdjustments && <SelectItem value="Refund">Refund</SelectItem>}
            </SelectContent>
          </Select>
          {invoice.type === 'Voided' && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Only the invoice number, date and remark are kept — the trip details and amounts on this invoice are
              discarded.
            </p>
          )}
          {/* Asked BEFORE anything is destroyed, per the spec ("worth a confirmation prompt on the
              type selector"). Voiding is not reversible from within the review screen — switching
              back to New cannot restore fields the parser read, only re-uploading the PDF can — so
              a single mis-click on this selector used to cost the whole invoice's scanned data. */}
          <Dialog open={voidTargetId === invoice.id} onOpenChange={(next) => !next && setVoidTargetId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Mark invoice {invoice.invoiceNumber ?? ''} as voided?</DialogTitle>
                <DialogDescription>
                  A voided invoice records only its invoice number, booking date and remark. The PNR, airline, cities,
                  dates and amounts read from this scan are discarded, and switching back to New will not bring them
                  back — you would have to scan the PDF again.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setVoidTargetId(null)}>
                  Keep the trip details
                </Button>
                <Button type="button" variant="destructive" onClick={applyVoid}>
                  Discard and mark as voided
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="scan-invoice-number">Invoice #</Label>
            <IconInput
              id="scan-invoice-number"
              aria-label="Invoice number"
              icon={<Hash />}
              value={invoice.invoiceNumber ?? ''}
              onChange={(e) => onChange({ ...invoice, invoiceNumber: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scan-pnr">PNR</Label>
            <IconInput
              id="scan-pnr"
              aria-label="PNR"
              icon={<Ticket />}
              value={invoice.pnr ?? ''}
              onChange={(e) => onChange(withPnr(invoice, e.target.value))}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="scan-booking-date">Booking Date</Label>
          <DateField
            id="scan-booking-date"
            ariaLabel="Booking Date"
            value={invoice.bookingDate ?? ''}
            onChange={(iso) => onChange({ ...invoice, bookingDate: iso || null })}
          />
        </div>

        {/* Rendered for EVERY type, not just Voided: a remark is a per-passenger ledger field on
            any booking, and a voided invoice's remark is the only thing besides its number and date
            that survives to the ledger at all (see `toCreateBookingInput`'s Voided branch). */}
        <div className="space-y-1">
          {/* Per-INVOICE payment, seeded from the page's batch default. Owner-reported: one
              status/type for the whole stack is wrong, because a scanned batch routinely mixes
              paid and pending invoices. Hidden for Voided, which records no payment at all
              (`toCreateBookingInput`'s Voided branch discards it), so offering the control there
              would imply a choice that has no effect. Still no per-invoice AMOUNT — that is a
              per-PASSENGER figure; see `ScanPaymentDefaults`. */}
          {invoice.type !== 'Voided' && (
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1">
                <Label htmlFor="scan-payment-status">Payment status</Label>
                <Select
                  value={invoice.paymentStatus ?? 'paid'}
                  onValueChange={(v) => onChange({ ...invoice, paymentStatus: v as 'paid' | 'pending' })}
                >
                  <SelectTrigger id="scan-payment-status" aria-label="Payment status" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="scan-payment-type">Payment type</Label>
                <Select
                  value={invoice.paymentType ?? 'card'}
                  onValueChange={(v) => onChange({ ...invoice, paymentType: v as 'card' | 'check' | 'cash' })}
                >
                  <SelectTrigger id="scan-payment-type" aria-label="Payment type" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <Label htmlFor="scan-remark">Remark</Label>
          <Input
            id="scan-remark"
            aria-label="Remark"
            value={invoice.remark ?? ''}
            onChange={(e) => onChange({ ...invoice, remark: e.target.value })}
            placeholder="Optional note stored on every passenger"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="scan-airline">Airline</Label>
          {/*
            `key={invoice.id + '-airline'}` — DO NOT remove this as "redundant" the way
            ScanInvoiceDetail's OWN remount key was removed in fix round 1 (that removal was
            correct: it was only propping up a local `voidWarningVisible` flag that no longer
            exists, and ScanInvoiceDetail itself genuinely holds no state).

            This key exists for a DIFFERENT reason: `CodeSearchField` (a component this file does
            not own) keeps its own local `query`/`debouncedQuery`/open-dropdown state, and that
            state does NOT reset when its `value` prop changes. Without a key here, switching to a
            different invoice while a suggestion dropdown is still open leaves that stale, still-
            clickable suggestion floating over the NEWLY-selected invoice's field — clicking it
            then writes the stale match's code onto the wrong invoice (proved live: type "Hous" on
            invoice A, switch to invoice B without dismissing the dropdown, click "Houston" — IAH
            lands in invoice B's depCity). Keying on `invoice.id` forces exactly this field to
            remount on an invoice switch, closing any open dropdown and clearing its search state,
            without touching `CodeSearchField` itself (shared by booking-form.tsx, enquiry-dialog.tsx,
            fare-option-dialog.tsx, multi-code-search-field.tsx — changing ITS behavior was ruled a
            wider-blast-radius fix than this). Same reasoning applies to the two City fields below.
            Regression test: InvoiceScanPage.test.tsx, "does not let a stale suggestion...".
          */}
          <CodeSearchField
            key={`${invoice.id}-airline`}
            id="scan-airline"
            ariaLabel="Airline"
            value={invoice.airlineCode ?? ''}
            onChange={(code) => onChange({ ...invoice, airlineCode: code })}
            onPick={(option) => onChange({ ...invoice, airlineCode: option.code, airlineName: option.label })}
            search={searchAirlines}
            queryKey="airlines"
            placeholder="e.g. Qatar or QR"
            icon={<Plane />}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="scan-dep-city">Departure City</Label>
            {/* Keyed on invoice.id — see the long comment on the Airline field above. */}
            <CodeSearchField
              key={`${invoice.id}-dep-city`}
              id="scan-dep-city"
              ariaLabel="Departure City"
              value={invoice.depCity ?? ''}
              onChange={(depCity) => onChange({ ...invoice, depCity })}
              search={searchAirports}
              queryKey="airports"
              placeholder="e.g. Houston or IAH"
              icon={<PlaneTakeoff />}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scan-arr-city">Arrival City</Label>
            {/* Keyed on invoice.id — see the long comment on the Airline field above. */}
            <CodeSearchField
              key={`${invoice.id}-arr-city`}
              id="scan-arr-city"
              ariaLabel="Arrival City"
              value={invoice.arrCity ?? ''}
              onChange={(arrCity) => onChange({ ...invoice, arrCity })}
              search={searchAirports}
              queryKey="airports"
              placeholder="e.g. Kochi or COK"
              icon={<PlaneLanding />}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="scan-dep-date">Departure Date</Label>
            <DateField
              id="scan-dep-date"
              ariaLabel="Departure Date"
              value={invoice.depDate ?? ''}
              onChange={(iso) => onChange({ ...invoice, depDate: iso || null })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scan-arr-date">Arrival Date</Label>
            <DateField id="scan-arr-date" ariaLabel="Arrival Date" value={activeArrDate ?? ''} onChange={setArrDate} />
            {showArrAlternative && otherArrDate && (
              <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={toggleArrDateChoice}>
                Use {formatDisplayDate(otherArrDate)}
              </Button>
            )}
          </div>
        </div>

        {/* A voided invoice carries no passengers worth linking — it's recorded as nothing but an
            invoice number, date and remark, so the whole section is hidden rather than shown
            empty or disabled. */}
        {/*
          `key={invoice.id}` — DO NOT remove this as "redundant" the way ScanInvoiceDetail's OWN
          remount key was removed in fix round 1 (that removal was correct: ScanInvoiceDetail
          itself genuinely holds no state). `ScanPassengerRows` is the opposite case: it owns
          real local state — which row's customer-search box is open, the typed query, its
          resolved matches, and the `linked` display-name cache — and NOTHING in the chain above
          it (`InvoiceScanPage` renders `<ScanInvoiceDetail invoice={selected} />` unkeyed) ever
          reset that state on an invoice switch. Without this key, clicking a different row in the
          invoice list reused the SAME `ScanPassengerRows` instance with a new `invoice` prop:
          (1) the mount-only auto-link effect never re-ran for any invoice after the first one
          selected, silently forcing every later invoice to 100% manual linking, and (2) proved
          live — search "Doe" on invoice A's passenger (one match, Doe/Jane), switch to invoice B
          WITHOUT picking, click the still-rendered suggestion — Doe/Jane linked onto invoice B's
          actual passenger. A customer linked to the wrong human on a booking-ledger record.
          Keying on `invoice.id` forces the WHOLE component to remount on a switch, discarding all
          of the above along with it. Same reasoning as the per-field `CodeSearchField` keys above
          (a sibling task fixed the identical class of bug there) — placed at the call site of the
          STATEFUL child, not by keying the stateless `ScanInvoiceDetail` itself.
          Regression tests: scan-invoice-detail.test.tsx, "does not let a stale customer
          suggestion..." and "re-runs auto-link for a newly-selected invoice...".
        */}
        {invoice.type !== 'Voided' && (
          <ScanPassengerRows key={invoice.id} invoice={invoice} onChange={onChange} resolver={resolver} />
        )}

        {/* Reissue/Refund only — an adjustment attaches to an existing New passenger, so the
            operator must confirm which original passenger it adjusts before it can be saved (see
            `statusFor` in reviewInvoice.ts). Keyed on invoice.id (suffixed, NOT bare `invoice.id` —
            that collided with ScanPassengerRows' own key above: both render as SIBLINGS in this
            same children list for a Reissue/Refund invoice, which is non-Voided, so both are
            present at once and React warned "two children with the same key" — fix round 2) for
            the same reason as ScanPassengerRows above: it holds its own in-flight search state via
            refs, and reusing the same instance across an invoice switch would let a stale lookup
            resolve onto the wrong invoice. */}
        {(invoice.type === 'Reissue' || invoice.type === 'Refund') && (
          <ScanAdjustmentParent key={`${invoice.id}-adjustment-parent`} invoice={invoice} onChange={onChange} />
        )}

        {invoice.issues.length > 0 && (
          <div className="space-y-1 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Issues to review
            </p>
            <ul className="list-inside list-disc">
              {invoice.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
