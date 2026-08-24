import { ScannedInvoice, ScannedPassenger } from '@/utils/invoiceScan/types';

/** Half a cent — anything closer than this is float noise, not a real discrepancy. */
const AMOUNT_TOLERANCE = 0.005;

/** What the passengers currently add up to. A null (unread) amount counts as zero, matching what
 *  `saveScannedInvoice` would actually write. */
export function passengerAmountTotal(passengers: Pick<ScannedPassenger, 'amount'>[]): number {
  return passengers.reduce((sum, p) => sum + (p.amount ?? 0), 0);
}

/**
 * Whether the passenger amounts agree with the invoice's own printed `NET CC BILLING`.
 *
 * Shared on purpose by the review screen's amounts summary (`ScanPassengerRows`) and the batch-save
 * gate (`InvoiceScanPage`'s "Save all ready"): if the display applied its own rounding rule, an
 * invoice could read as balanced on screen while the batch silently skipped it, or vice versa.
 *
 * An invoice with no `netCcBilling` on file has nothing to reconcile against and always passes —
 * never treat a total OCR could not read as zero, which would report the entire invoice as
 * unallocated.
 */
export function reconciles(invoice: Pick<ReviewInvoice, 'netCcBilling' | 'passengers'>): boolean {
  if (invoice.netCcBilling === null) return true;
  return Math.abs(passengerAmountTotal(invoice.passengers) - invoice.netCcBilling) <= AMOUNT_TOLERANCE;
}

/** `'duplicate'` is a SAVE-OUTCOME status, set by the page after a 409 `DUPLICATE_BOOKING_WARNING`
 * — like `'saved'`/`'failed'`, `statusFor` below never produces it. It exists so a duplicate hit
 * during a "Save all ready" batch is visibly distinct from an untouched `'ready'` row in the list
 * — without it, a row the batch left unresolved looked identical to one nobody had attempted. */
export type ReviewStatus = 'ready' | 'attention' | 'duplicate' | 'saved' | 'failed';

/** A scanned invoice plus the review screen's own per-row state. */
export interface ReviewInvoice extends ScannedInvoice {
  /** Stable key for React and for selection; scans have no natural id. */
  id: string;
  status: ReviewStatus;
  saveError?: string;
  /** Resolved IATA codes, null when the operator still has to pick. */
  airlineCode: string | null;
  depCity: string | null;
  arrCity: string | null;
  /** Which arrival-date candidate is in force. */
  arrDateChoice: 'return' | 'final';
  /** Free-text ledger remark, `null` until the operator types one. Not parsed from the scan (the
   * Sabre layout carries no remark field) — it exists because the spec records a VOIDED invoice as
   * "Invoice #, Booking Date and Remark", and confirming a void pre-fills it with `VOID`. Applied
   * to every passenger on save (remarks are per-passenger since 2026-07-17), and to the `VOID`
   * placeholder for a voided invoice. */
  remark: string | null;
  /**
   * This invoice's own payment status and type. Optional: `undefined` means "fall back to the
   * page's batch control", which is what the batch control now is — a DEFAULT, not a setting
   * applied uniformly at save time. Owner-reported after browser testing: one status/type for the
   * whole stack is wrong, because a single scanned batch routinely mixes paid and pending
   * invoices. `toReviewInvoice` seeds both from the batch control when a scan is parsed, and
   * changing the batch control re-applies it to every not-yet-saved invoice, so the batch remains
   * a one-click way to set the common case without preventing any invoice from differing.
   *
   * There is deliberately still no per-invoice AMOUNT — a payment amount is per PASSENGER, and
   * `ScanPaymentDefaults` records why one shared figure was a money bug.
   */
  paymentStatus?: 'paid' | 'pending';
  paymentType?: 'card' | 'check' | 'cash';
  /** Customer id per passenger index; null until linked. */
  customerIds: (string | null)[];
  /**
   * For Reissue/Refund only: WHICH PNR to look the original booking up under.
   *
   * Seeded from the scanned `pnr` (the overwhelmingly common case — a reissue usually keeps its
   * PNR), but deliberately a SEPARATE field, because the two are not interchangeable:
   *   - `pnr` is the adjustment's OWN record locator, and is what `saveScannedAdjustment` POSTs.
   *     A reissue is sometimes ticketed under a NEW PNR, in which case it is not the original's.
   *   - `originalPnr` only ever addresses the booking being adjusted. Correcting an OCR misread
   *     here must not rewrite what gets saved on the adjustment.
   * Editing it clears any resolved `parentPassengerIds`, since they belonged to the old PNR.
   */
  originalPnr: string | null;
  /** For Reissue/Refund only: the original (New) passenger each row adjusts, resolved by
   * `ScanAdjustmentParent` from `originalPnr`. Always present (one slot per scanned passenger,
   * `null` until resolved) but only load-bearing for `statusFor`/saving on those two types. */
  parentPassengerIds: (string | null)[];
  /** For Reissue/Refund only: the `AdjustmentResponse.id` returned once a passenger's adjustment
   * has actually been POSTed, `null` until then. Adjustments have NO duplicate-invoice 409 to
   * catch a re-post, so this is the only thing standing between a retried "Save" and silently
   * double-counting a reissue/refund in the ledger: `saveScannedAdjustment` skips any index that
   * already has an id here, and `InvoiceScanPage`'s `performSave` persists each one into state the
   * moment it succeeds — BEFORE the whole invoice's save settles — so a later passenger throwing never
   * loses an earlier passenger's already-created adjustment to a naive from-scratch retry. Not
   * read by `statusFor` (saving is what populates it, not a precondition for reaching Ready). */
  adjustmentIds: (string | null)[];
  /** The exact `amount` that was ACTUALLY POSTED for each index already
   * present in `adjustmentIds` — `null` until that index has succeeded. Skipping an already-posted
   * passenger on retry (see `adjustmentIds`) is correct — it must never be re-POSTed — but it means
   * an operator who edits that passenger's amount AFTER it succeeded, then re-saves, would get no
   * signal that the correction was silently not applied. `InvoiceScanPage.performSave` compares
   * each already-posted index's LIVE `passengers[i].amount` against this recorded value before
   * every save attempt and toasts a warning on a mismatch. Not read by `statusFor`. */
  adjustmentAmounts: (number | null)[];
}

/**
 * Whether an invoice can be saved, re-derived from LIVE state on every change.
 *
 * Deliberately does NOT gate on `issues`: that is a frozen scan-time snapshot, never recomputed,
 * so gating on it froze an invoice at 'attention' forever even after the operator corrected the
 * field it complained about. `issues` is advisory display text only.
 *
 * Only two kinds of condition belong here: those that would write invalid data (checked against
 * the backend Zod schemas, never against this repo's own optional markers) and those re-derivable
 * from current state. Everything else `issues` reports is structural or overridable by an operator
 * who has read the page image.
 *
 * A reconciliation mismatch is NOT checked here. It excludes an invoice from the batch save only
 * (`InvoiceScanPage`'s `reconciles()`), because that warning renders for the selected invoice
 * alone; it must never block the individual Save button.
 */
export function statusFor(
  invoice: Pick<
    ReviewInvoice,
    'customerIds' | 'type' | 'parentPassengerIds' | 'passengers' | 'pnr' | 'airlineCode'
  >
): ReviewStatus {
  if (invoice.type === 'Voided') return 'ready';
  if (invoice.customerIds.some((id) => id === null)) return 'attention';
  if (invoice.passengers.some((p) => p.amount === null)) return 'attention';
  if (!invoice.pnr) return 'attention';
  if (invoice.type === 'New' && !invoice.airlineCode) return 'attention';
  if (
    (invoice.type === 'Reissue' || invoice.type === 'Refund') &&
    invoice.parentPassengerIds.some((id) => id === null)
  ) {
    return 'attention';
  }
  return 'ready';
}
