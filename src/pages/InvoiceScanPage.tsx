import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import ScanInvoiceDetail from '@/components/invoice-scan/scan-invoice-detail';
import ScanInvoiceList from '@/components/invoice-scan/scan-invoice-list';
import { ReviewInvoice, ReviewStatus, statusFor } from '@/components/invoice-scan/reviewInvoice';
import {
  SaveOutcome,
  ScanPaymentDefaults,
  saveScannedAdjustment,
  saveScannedInvoice,
} from '@/components/invoice-scan/saveScannedInvoice';
import { DuplicateInvoice } from '@/api/bookings.api';
import { formatDisplayDate } from '@/utils/dateFormat';
import { ScanResolver, buildResolver } from '@/utils/invoiceScan/resolve';
import { ScanProgress, scanPdf } from '@/utils/invoiceScan/ocr/scanPdf';
import { ScannedInvoice } from '@/utils/invoiceScan/types';

/** A Reissue/Refund is an adjustment against an existing New passenger, not a new booking — it
 * saves through `saveScannedAdjustment` (`POST /passengers/:id/adjustments`), never
 * `saveScannedInvoice` (`POST /bookings`), which would silently create a bogus New booking
 * instead. `statusFor` already keeps a Reissue/Refund out of `'ready'` until its
 * `parentPassengerIds` are resolved (see `ScanAdjustmentParent`), so no separate save-eligibility
 * gate is needed here beyond picking the right function to call. */
function isAdjustmentType(invoice: ReviewInvoice): boolean {
  return invoice.type === 'Reissue' || invoice.type === 'Refund';
}

/** An invoice may be SAVED only when it's actually `'ready'` — or `'failed'`, so a save that hit a
 * transient/backend error can be retried without an edit first. (`'failed'` is reachable from more
 * than just `'ready'` — a "Save anyway" on a `'duplicate'` invoice can itself fail — but every path
 * into `'failed'` starts from data `statusFor` already accepted as complete, so retrying it
 * re-attempts already-valid data either way.) **`'attention'` must never pass this gate**:
 * `statusFor` puts an invoice there for a real, LIVE reason — a passenger amount the OCR couldn't
 * read (`passenger.amount === null`; see `parsePassengers.ts`) or an unlinked passenger — and either
 * one saving anyway would silently write a wrong number or an unlinked passenger into the ledger
 * with no warning. `'duplicate'` (a 409 the operator hasn't resolved yet) and `'saved'` also fail
 * this gate on purpose: both have their own dedicated UI (the amber panel / the disabled "Saved"
 * button) instead of the plain Save action. */
function canAttemptSave(invoice: ReviewInvoice): boolean {
  return invoice.status === 'ready' || invoice.status === 'failed';
}

/** Whether an invoice may be included in the "Save all ready" BATCH — narrower than `'ready'`.
 * A well-formed OCR misread (`4,275.29` read as `4,215.29`) leaves every passenger `amount`
 * non-null, so `statusFor`'s amount gate passes and the badge reads Ready — but the passenger
 * total then disagrees with the invoice's own printed `NET CC BILLING`, exactly the mismatch
 * `parsePassengers.ts` already flags as an (advisory-only) issue. The amber "Issues to review"
 * panel that would show this only ever renders for the currently SELECTED invoice
 * (`scan-invoice-detail.tsx`), so a batch save can write the misread figure into the ledger with
 * the operator never having seen the warning. This does NOT apply to the per-invoice Save button
 * — an operator who has actually opened this invoice and read the page image may legitimately
 * need to save it anyway (a real total can genuinely not match what OCR read); that override, kept
 * from fix round 2, stays available there. Only ever narrows the batch, never widens it: an invoice
 * with no `netCcBilling` on file (nothing to reconcile against) always reconciles. */
function reconciles(invoice: ReviewInvoice): boolean {
  if (invoice.netCcBilling === null) return true;
  const total = invoice.passengers.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  return Math.abs(total - invoice.netCcBilling) <= 0.005;
}

/**
 * Re-derives a row's status from its CURRENT data — but only for the statuses that are genuinely a
 * live derivation. `statusFor` can only ever return `'ready'` or `'attention'`; the other three
 * (`'saved'`, `'failed'`, `'duplicate'`) record what happened on a save attempt, which no amount of
 * editing can un-happen.
 *
 * **`'saved'` is TERMINAL.** Recomputing it unconditionally (the original behaviour of both
 * `mergeResolved` and `handleDetailChange`) flipped an invoice already written to the ledger back
 * to `'ready'` on any post-save edit — or on a city lookup that merely happened to resolve after
 * the save — which re-enabled Save on it. Worse, if that edit touched `invoiceNumber`,
 * `bookingDate` or `pnr`, the backend's own 409 duplicate check could no longer catch the second
 * write either, because the dedupe triple no longer matched the row just created. `clearDuplicate`
 * already guarded its recompute on the current status; this is the same rule, applied everywhere.
 *
 * `'duplicate'` is likewise preserved: the amber decision panel is driven by the `duplicates` map,
 * and "Go back" (`clearDuplicate`) is the one path that deliberately returns it to a live status.
 *
 * `'failed'` stays retryable — `canAttemptSave` permits it — but an edit that makes the invoice
 * INCOMPLETE must still block, so a recomputed `'attention'` wins over it.
 */
function recomputeStatus(invoice: ReviewInvoice): ReviewStatus {
  if (invoice.status === 'saved' || invoice.status === 'duplicate') return invoice.status;
  const next = statusFor(invoice);
  return invoice.status === 'failed' && next === 'ready' ? 'failed' : next;
}

/** `batch` is the upload's generation number, so ids are unique across uploads and not merely
 * within one. Ids used to be `scan-${index}` alone, which meant a second upload reproduced the
 * first's ids exactly — and every piece of id-keyed state (the `duplicates` map, `selectedId`, the
 * `${invoice.id}-<field>` remount keys guarding `CodeSearchField`'s local dropdown state) would
 * then apply the OLD batch's state to a completely different PDF's invoice. Re-uploading is the
 * spec's normal recovery path for an interrupted batch, so this is an ordinary action, not an edge
 * case. `handleFile` also resets all of that state per upload; the unique id is defence in depth. */
function toReviewInvoice(
  invoice: ScannedInvoice,
  batch: number,
  index: number,
  defaults: ScanPaymentDefaults
): ReviewInvoice {
  const base: ReviewInvoice = {
    ...invoice,
    id: `scan-${batch}-${index}`,
    status: 'attention',
    // Seeded from the batch control so an invoice always carries its own status/type from the
    // moment it is parsed. The operator then changes whichever invoices differ, instead of one
    // setting silently deciding the payment for the whole stack.
    paymentStatus: defaults.status,
    paymentType: defaults.type,
    airlineCode: null,
    depCity: null,
    arrCity: null,
    arrDateChoice: 'return',
    remark: null,
    customerIds: invoice.passengers.map(() => null),
    parentPassengerIds: invoice.passengers.map(() => null),
    adjustmentIds: invoice.passengers.map(() => null),
    adjustmentAmounts: invoice.passengers.map(() => null),
  };
  return { ...base, status: statusFor(base) };
}

export default function InvoiceScanPage() {
  const [invoices, setInvoices] = useState<ReviewInvoice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageImages, setPageImages] = useState<Map<number, string>>(new Map());
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every new file pick. A running scan captures the post-bump value into its own
  // `generation` closure constant; before writing ANY state (progress, results, or error) it
  // compares that captured value against the ref's CURRENT value. If they differ, a later scan
  // has since started and this one is stale — its write is dropped silently. A ref (not state)
  // is required because the comparison must read the LATEST value at settle time, not whatever
  // was captured when the async function was called. This is what stops a slow first scan that
  // is still in flight when the operator picks a second file from clobbering the second scan's
  // already-displayed results when the first one finally settles.
  const generationRef = useRef(0);

  // The batch payment control applied to every passenger of whichever invoice is being saved —
  // mirrors BookingImportWizard's PaymentDefault control. Status and type ONLY: there is
  // deliberately no shared "Amount owed" field, because a payment amount is a PER-PASSENGER
  // outstanding balance and a Pending passenger owes its own full ticket price. See
  // `ScanPaymentDefaults` in saveScannedInvoice.ts for the full rule and the money bug that a
  // single shared figure caused.
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'pending'>('paid');
  const [paymentType, setPaymentType] = useState<'card' | 'check' | 'cash'>('card');
  // Keyed by invoice id — a save that comes back 409 DUPLICATE_BOOKING_WARNING renders the amber
  // panel for that specific invoice; the invoice's own `status` ALSO flips to `'duplicate'` (see
  // `performSave`) so the list badge itself shows a row still needs a decision, not just the panel
  // on whichever invoice happens to be selected.
  const [duplicates, setDuplicates] = useState<Record<string, DuplicateInvoice>>({});
  // The one invoice currently being POSTed, if any — guards against overlapping save requests from
  // both the per-invoice Save button and the "Save all ready" loop (which is otherwise fully
  // sequential: one failure must not stop the rest, so it's a plain for-of, not Promise.all).
  const [savingId, setSavingId] = useState<string | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);

  const queryClient = useQueryClient();

  // ONE resolver instance for the whole review session, not one per invoice selection —
  // `resolve.ts`'s airline/airport memoisation only pays off if the SAME instance (and therefore
  // its internal cache) is reused across invoices. A batch of dozens of invoices realistically
  // repeats only a handful of distinct airlines/cities, so this is what turns "one network request
  // per invoice" into "one request per DISTINCT airline/city in the whole batch". (Lazy `useRef`
  // init, not `useRef(buildResolver())`, so a fresh resolver — and its cache — isn't constructed
  // and discarded on every render, only ever once.)
  const scanResolverRef = useRef<ScanResolver | null>(null);
  if (!scanResolverRef.current) scanResolverRef.current = buildResolver();
  // Non-null alias for the render tree. `ScanPassengerRows` takes this same instance rather than
  // building its own: it is keyed on `invoice.id`, so it remounts on every invoice switch, and a
  // per-mount resolver gave each remount an empty cache that re-issued the same customer lookups.
  const scanResolver = scanResolverRef.current;

  /** One invoice's effective payment, its own value winning over the batch default. */
  function buildPayment(invoice?: ReviewInvoice): ScanPaymentDefaults {
    return {
      status: invoice?.paymentStatus ?? paymentStatus,
      type: invoice?.paymentType ?? paymentType,
    };
  }

  /** The batch control is a DEFAULT, so changing it re-applies to every invoice not already
   *  written to the ledger. A saved invoice is left alone — its payment is the API's now, and
   *  silently rewriting the row's displayed status would misreport what was actually sent. */
  function applyBatchStatus(status: 'paid' | 'pending') {
    setPaymentStatus(status);
    setInvoices((prev) => prev.map((inv) => (inv.status === 'saved' ? inv : { ...inv, paymentStatus: status })));
  }

  function applyBatchType(type: 'card' | 'check' | 'cash') {
    setPaymentType(type);
    setInvoices((prev) => prev.map((inv) => (inv.status === 'saved' ? inv : { ...inv, paymentType: type })));
  }

  /** Clears any pending-duplicate panel for an invoice. When called as part of "Go back" (the
   * invoice's status is still `'duplicate'`), it ALSO reverts status back to whatever `statusFor`
   * says now — equivalent to `'ready'` here, since nothing about the invoice's own data changed,
   * only the outcome of the last save attempt. When called from `performSave`'s saved/failed
   * branches the status has already been overwritten to something else in the same tick, so this
   * check is a no-op there (see the ordering note on the two `setInvoices` calls). */
  function clearDuplicate(id: string) {
    setDuplicates((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === id && inv.status === 'duplicate' ? { ...inv, status: statusFor(inv) } : inv))
    );
  }

  /** Saves one invoice and reconciles every piece of state a save can touch: the row's status,
   * any pending duplicate panel for it, and (on success) the shared Bookings/Sales query cache —
   * the same invalidation the import wizards do, so the freshly-saved invoice shows up without a
   * manual refresh. Independent per invoice: a failure here never throws, so the "Save all ready"
   * loop always reaches the next one. Returns the outcome kind so a batch can tally what actually
   * happened, rather than re-reading `invoices` state afterward (which could have moved on). */
  /** Persists ONE passenger's just-created adjustment id into `invoices` state immediately —
   * called from inside `saveScannedAdjustment`'s loop, before the invoice's overall save outcome
   * is known. This is what lets a later passenger's failure be retried without re-POSTing this
   * one: the next `performSave` call reads `invoice.adjustmentIds` off the (by-then-updated)
   * `invoices` state via `selected`, so the retry's loop skips straight past it. See
   * `saveScannedAdjustment`'s own comment for the full "why" — adjustments have no 409 to catch a
   * duplicate POST the way New bookings do. */
  function recordAdjustmentProgress(invoiceId: string, index: number, adjustmentId: string, amount: number) {
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === invoiceId
          ? {
              ...inv,
              adjustmentIds: inv.adjustmentIds.map((id, i) => (i === index ? adjustmentId : id)),
              adjustmentAmounts: inv.adjustmentAmounts.map((a, i) => (i === index ? amount : a)),
            }
          : inv
      )
    );
  }

  /** Fix round 2, Minor 4: an already-posted passenger's amount is deliberately NEVER re-sent (see
   * `saveScannedAdjustment`'s skip logic) — correct, since adjustments have no duplicate-invoice
   * 409 to catch a re-post. But silently ignoring an operator's correction is its own bug: if they
   * edit passenger 1's amount after its adjustment succeeded, then re-save, nothing told them the
   * new figure never went anywhere. Checked before EVERY save attempt (not just after a failure),
   * so it fires as soon as the mismatch exists, independent of this attempt's own outcome. */
  function warnOfStaleAdjustmentAmounts(invoice: ReviewInvoice) {
    const staleIndexes = invoice.passengers
      .map((passenger, index) => ({ passenger, index }))
      .filter(
        ({ passenger, index }) =>
          invoice.adjustmentIds[index] !== null && invoice.adjustmentAmounts[index] !== passenger.amount
      );
    if (staleIndexes.length === 0) return;
    const names = staleIndexes.map(({ passenger }) => passenger.name).join(', ');
    toast.error(
      `${names}: this adjustment was already saved and the changed amount will NOT be re-sent. Delete and recreate it if the new amount is correct.`
    );
  }

  async function performSave(invoice: ReviewInvoice, confirmDuplicate: boolean): Promise<SaveOutcome['kind']> {
    setSavingId(invoice.id);
    try {
      if (isAdjustmentType(invoice)) warnOfStaleAdjustmentAmounts(invoice);
      // Adjustments have no duplicate-invoice concept (that 409 is a Bookings-only guard), so
      // `confirmDuplicate` is simply unused on that path — `saveScannedAdjustment`'s outcome can
      // never be `'duplicate'`.
      const outcome = isAdjustmentType(invoice)
        ? await saveScannedAdjustment(invoice, buildPayment(invoice), (index, adjustmentId, amount) =>
            recordAdjustmentProgress(invoice.id, index, adjustmentId, amount)
          )
        : await saveScannedInvoice(invoice, buildPayment(invoice), confirmDuplicate);
      if (outcome.kind === 'saved') {
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === invoice.id ? { ...inv, status: 'saved', saveError: undefined } : inv))
        );
        clearDuplicate(invoice.id);
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
        queryClient.invalidateQueries({ queryKey: ['sales'] });
        toast.success('Invoice saved');
      } else if (outcome.kind === 'duplicate') {
        // The status change is what makes this visible in the LIST even when this invoice isn't
        // the one currently selected — the amber panel below only ever renders for the selected
        // invoice, so without this a duplicate hit during a batch looked identical to a row nobody
        // had attempted yet (still showing the blue "Ready" badge).
        setInvoices((prev) => prev.map((inv) => (inv.id === invoice.id ? { ...inv, status: 'duplicate' } : inv)));
        setDuplicates((prev) => ({ ...prev, [invoice.id]: outcome.duplicate }));
      } else {
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === invoice.id ? { ...inv, status: 'failed', saveError: outcome.message } : inv))
        );
        clearDuplicate(invoice.id);
      }
      return outcome.kind;
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveAll() {
    // Snapshot the ready list up front — `invoices` state changes as each save resolves, and the
    // batch should work through the invoices that were ready when it started, not a live-shrinking
    // list that could skip one. Split out from the reconciliation check below so the toast can
    // report a skip separately from a save/duplicate/failure — a `'ready'` invoice that fails
    // `reconciles()` is never attempted at all here (see that function's doc comment for why).
    const eligible = invoices.filter((invoice) => invoice.status === 'ready');
    const ready = eligible.filter(reconciles);
    const skippedCount = eligible.length - ready.length;
    setBatchSaving(true);
    let savedCount = 0;
    let needsDecisionCount = 0;
    let failedCount = 0;
    try {
      for (const invoice of ready) {
        // Deliberately sequential (not Promise.all) — see the comment above.
        const kind = await performSave(invoice, false);
        if (kind === 'saved') savedCount += 1;
        else if (kind === 'duplicate') needsDecisionCount += 1;
        else failedCount += 1;
      }
    } finally {
      setBatchSaving(false);
      // Every row's own badge already shows what happened to it (see performSave), but a batch can
      // run across many invoices at once and a duplicate/failure can land on a row that isn't the
      // one currently selected — this summary is the belt-and-braces signal that the batch did NOT
      // finish cleanly, so the operator knows to go looking rather than assuming every row saved.
      if (needsDecisionCount > 0 || failedCount > 0 || skippedCount > 0) {
        const parts = [`${savedCount} saved`];
        if (skippedCount > 0) {
          parts.push(`${skippedCount} skipped (amount doesn't match NET CC BILLING — review and save individually)`);
        }
        if (needsDecisionCount > 0) {
          parts.push(`${needsDecisionCount} need${needsDecisionCount === 1 ? 's' : ''} a decision`);
        }
        if (failedCount > 0) parts.push(`${failedCount} failed`);
        toast.error(`Save all ready: ${parts.join(', ')}.`);
      }
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const generation = ++generationRef.current;
    // EVERY piece of per-batch state resets here, not just `invoices`. `duplicates` in particular
    // used to survive, and since ids also regenerated identically per upload (`scan-0`, …) a
    // duplicate warning raised against the PREVIOUS PDF's invoice re-rendered against the new one —
    // whose only Save affordance is "Save anyway", which sends `confirmDuplicate: true` and so
    // bypasses the duplicate check entirely for an invoice that was never checked. Re-uploading is
    // the spec's normal recovery path for an interrupted batch (client-side parsing cannot resume),
    // so this is an ordinary action. If a new piece of per-invoice page state is ever added, it
    // belongs in this list.
    setError(null);
    setInvoices([]);
    setSelectedId(null);
    setPageImages(new Map());
    setDuplicates({});
    setProgress({ phase: 'rendering', done: 0, total: 0 });

    try {
      const result = await scanPdf(file, (nextProgress) => {
        if (generationRef.current === generation) setProgress(nextProgress);
      });
      if (generationRef.current !== generation) return;
      const reviewed = result.invoices.map((invoice, index) =>
        toReviewInvoice(invoice, generation, index, buildPayment())
      );
      setInvoices(reviewed);
      setPageImages(result.pageImages);
      setSelectedId(reviewed[0]?.id ?? null);
    } catch {
      if (generationRef.current !== generation) return;
      setError('Could not read that PDF. Check the file and try again.');
    } finally {
      if (generationRef.current === generation) setProgress(null);
    }
  }

  const selected = invoices.find((invoice) => invoice.id === selectedId) ?? null;

  /** Writes one resolved field onto ONE invoice (by id, never "whichever is selected NOW") and
   * recomputes its status — status must be recomputed here because a resolved `airlineCode` is
   * exactly what can flip a New invoice from `'attention'` to `'ready'` (see `statusFor`). Guards
   * against overwriting a value that's already set by the time the lookup resolves — either an
   * earlier resolution that already succeeded, or the operator having since picked one by hand via
   * `CodeSearchField` — an auto-resolution must never clobber either. */
  function mergeResolved(invoiceId: string, field: 'airlineCode' | 'depCity' | 'arrCity', code: string) {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== invoiceId || inv[field]) return inv;
        const next = { ...inv, [field]: code };
        return { ...next, status: recomputeStatus(next) };
      })
    );
  }

  // Auto-resolves `airlineCode`/`depCity`/`arrCity` from the raw OCR'd text (`airlineName`/
  // `depCityText`/`arrCityText`) — the fix round 3 Critical: these three were NEVER wired to
  // `resolve.ts`'s existing airline/airport resolvers (only the customer resolver, in
  // `scan-passenger-rows.tsx`, was ever actually called), so `airlineCode` in particular stayed
  // permanently null and every New invoice's "Save all ready" 400'd at the backend's
  // `voided || (pnr && airlineCode)` refine.
  //
  // Deliberately LAZY, keyed on `selected?.id` — fires once per invoice SELECTION, exactly
  // mirroring how customer auto-link already behaves (only the first invoice is auto-selected on
  // scan completion; every other invoice's own auto-link only fires once the operator clicks into
  // it). Chosen over resolving the whole batch eagerly right after scanning: a real batch of
  // dozens of invoices realistically repeats only a handful of distinct airlines/cities, but
  // firing 3 requests per invoice for, say, an 80-invoice batch the instant the scan finishes —
  // before the operator has looked at a single row, for invoices that might still turn out Voided
  // or need other fixes first — is both wasted work in the common case and a needless burst of
  // concurrent requests. Voided is skipped entirely: it never sends any of these three fields (see
  // `saveScannedInvoice.ts`'s Voided branch), so resolving them would be pure waste.
  useEffect(() => {
    if (!selected || selected.type === 'Voided') return;
    const invoiceId = selected.id;
    const resolver = scanResolverRef.current;
    if (!resolver) return;
    let cancelled = false;

    if (!selected.airlineCode && selected.airlineName) {
      resolver.airline(selected.airlineName).then((code) => {
        if (!cancelled && code) mergeResolved(invoiceId, 'airlineCode', code);
      });
    }
    if (!selected.depCity && selected.depCityText) {
      resolver.airport(selected.depCityText).then((code) => {
        if (!cancelled && code) mergeResolved(invoiceId, 'depCity', code);
      });
    }
    if (!selected.arrCity && selected.arrCityText) {
      resolver.airport(selected.arrCityText).then((code) => {
        if (!cancelled && code) mergeResolved(invoiceId, 'arrCity', code);
      });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on the id alone; see the comment above
  }, [selected?.id]);

  /** Replaces one invoice in place and recomputes its status from the edited fields — the detail
   * panel itself holds no data state, it only ever hands back a full next `ReviewInvoice`. */
  function handleDetailChange(next: ReviewInvoice) {
    setInvoices((prev) =>
      prev.map((invoice) => (invoice.id === next.id ? { ...next, status: recomputeStatus(next) } : invoice))
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4">
      <h2 className="text-2xl font-bold tracking-tight">Scan Invoices</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <h3 className="contents">Upload</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="scan-file">Scanned invoices (PDF)</Label>
          <Input
            id="scan-file"
            type="file"
            accept="application/pdf"
            onChange={handleFile}
            disabled={progress !== null}
          />
          {progress && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <Spinner />
              {progress.phase === 'rendering' ? 'Rendering pages' : 'Reading pages'} {progress.done}
              {progress.total > 0 ? ` of ${progress.total}` : ''}…
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {invoices.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xl">
                <h3 className="contents">
                  {invoices.length} invoice{invoices.length === 1 ? '' : 's'} found
                </h3>
              </CardTitle>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveAll}
                // A batch is safe under BOTH payment statuses now that the amount is derived
                // per passenger: Paid owes 0, Pending owes each passenger's own ticket price. The
                // previous blanket "disabled while Pending" existed only because ONE typed figure
                // was applied to every invoice the batch touched (see `ScanPaymentDefaults`), and
                // there is no such figure any more.
                disabled={
                  batchSaving || !invoices.some((invoice) => invoice.status === 'ready' && reconciles(invoice))
                }
              >
                {batchSaving && <Spinner />}
                Save all ready
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-4 border-b p-3">
                <div className="flex items-center gap-2">
                  <Label>Default payment status</Label>
                  <Select value={paymentStatus} onValueChange={(v) => applyBatchStatus(v as 'paid' | 'pending')}>
                    <SelectTrigger aria-label="Default payment status" className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label>Default payment type</Label>
                  <Select value={paymentType} onValueChange={(v) => applyBatchType(v as 'card' | 'check' | 'cash')}>
                    <SelectTrigger aria-label="Default payment type" className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {paymentStatus === 'pending' && (
                  <p className="w-full text-xs text-muted-foreground">
                    Each passenger is recorded as owing their own full ticket amount. Record a part payment afterwards
                    from the Bookings page.
                  </p>
                )}
              </div>
              <ScanInvoiceList invoices={invoices} selectedId={selectedId} onSelect={setSelectedId} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-4">
              {selected && (
                <>
                  <ScanInvoiceDetail
                    invoice={selected}
                    pageImage={pageImages.get(selected.pageStart)}
                    onChange={handleDetailChange}
                    resolver={scanResolver}
                  />

                  {duplicates[selected.id] ? (
                    <div className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                      <p className="font-medium">
                        Invoice {duplicates[selected.id].invoiceNumber} already exists with the same date and PNR.
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {formatDisplayDate(duplicates[selected.id].bookingDate)}
                        {duplicates[selected.id].pnr ? ` · ${duplicates[selected.id].pnr}` : ''}
                        {duplicates[selected.id].passengerNames.length > 0
                          ? ` · ${duplicates[selected.id].passengerNames.join(', ')}`
                          : ''}
                      </p>
                      <p className="mt-2">Is this a different invoice?</p>
                      <div className="mt-3 flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => clearDuplicate(selected.id)}>
                          Go back
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={savingId !== null}
                          onClick={() => performSave(selected, true)}
                        >
                          {savingId === selected.id && <Spinner />}
                          Save anyway
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        onClick={() => performSave(selected, false)}
                        disabled={!canAttemptSave(selected) || savingId !== null}
                      >
                        {savingId === selected.id && <Spinner />}
                        {selected.status === 'saved' ? 'Saved' : 'Save'}
                      </Button>
                      {selected.status === 'attention' && (
                        <p className="text-sm text-muted-foreground">
                          Resolve the issues and unlinked passengers above before saving.
                        </p>
                      )}
                      {selected.status === 'failed' && selected.saveError && (
                        <p className="text-sm text-destructive">{selected.saveError}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
