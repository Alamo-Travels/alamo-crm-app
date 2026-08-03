import { ScannedInvoice } from '@/utils/invoiceScan/types';

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
  /** For Reissue/Refund only: the original (New) passenger each row adjusts, resolved by
   * `ScanAdjustmentParent` from the scanned PNR. Always present (one slot per scanned passenger,
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
  /** Fix round 2, Minor 4: the exact `amount` that was ACTUALLY POSTED for each index already
   * present in `adjustmentIds` — `null` until that index has succeeded. Skipping an already-posted
   * passenger on retry (see `adjustmentIds`) is correct — it must never be re-POSTed — but it means
   * an operator who edits that passenger's amount AFTER it succeeded, then re-saves, would get no
   * signal that the correction was silently not applied. `InvoiceScanPage.performSave` compares
   * each already-posted index's LIVE `passengers[i].amount` against this recorded value before
   * every save attempt and toasts a warning on a mismatch. Not read by `statusFor`. */
  adjustmentAmounts: (number | null)[];
}

/**
 * `issues` (`ScannedInvoice.issues`) is a FROZEN scan-time snapshot — computed once by the OCR
 * pipeline (`parseInvoice.ts`/`parsePassengers.ts`/`parseItinerary.ts`) and never recomputed or
 * pruned by anything in the review screen, no matter what the operator edits. `statusFor`
 * therefore does NOT gate on `issues` at all — it is advisory DISPLAY TEXT ONLY (still rendered
 * verbatim in the "Issues to review" panel, `scan-invoice-detail.tsx`), never a save gate.
 *
 * Fix round 2: gating Ready on `issues.length === 0` (the original design) meant an invoice
 * carrying ANY scan-time finding — including the single most common one, a blank/unread passenger
 * amount (~1 in 6 per Task 1's own measurement) — could NEVER become Ready again once Save was
 * gated on status (fix round 1), even after the operator typed in the correct figure. It also
 * meant every auto-detected Reissue/Refund (`parseInvoice.ts`'s "Confirm Reissue or Refund and
 * enter the amount…" issue, added whenever `header.isAdjustment` fires) could never reach Ready
 * either, no matter how completely the operator resolved Task 13's parent-passenger gate below —
 * a second instance of the identical bug class the fix round exists to close.
 *
 * Only conditions that are (a) genuinely necessary to avoid writing silently-wrong/invalid data —
 * confirmed against the ACTUAL backend Zod schemas (`alamo-crm-api`'s `booking.controller.ts`'s
 * `createBookingSchema`/`AdjustmentInput` schema — never inferred from this repo's own TypeScript
 * `?` markers, which fix round 2 wrongly did for `pnr`) — and (b) re-derivable from CURRENT, live
 * invoice state are checked here:
 *   - a null passenger amount (`ScannedPassenger.amount === null`) — would otherwise write a real
 *     `$0` into the ledger with no warning (see `saveScannedInvoice.ts`'s `passenger.amount ?? 0`);
 *   - an unlinked non-Voided passenger (`customerIds`) — `scan-passenger-rows.tsx` documents this
 *     as mandatory with no grandfathering exemption;
 *   - a missing `pnr` on any non-Voided invoice — the backend's `createBookingSchema` refine is
 *     `voided || (pnr && airlineCode)` (both required together for a New booking), and its
 *     Adjustment schema requires `pnr` UNCONDITIONALLY regardless of `airlineCode` (per the
 *     workspace CLAUDE.md's "Booking's own pnr/airlineCode/… and Adjustment's (Reissue/Refund)
 *     airlineCode/… are all now optional… Adjustment's pnr and payment stay required" note) — so
 *     `pnr` blocks Ready for New AND Reissue/Refund alike;
 *   - a missing `airlineCode` on a **New** invoice ONLY — required in lockstep with `pnr` by that
 *     same refine; Reissue/Refund's own Adjustment schema does NOT require it (sent only when
 *     present — see `saveScannedAdjustment`'s conditional spread), so a Reissue/Refund must NOT be
 *     gated on it;
 *   - an unresolved Reissue/Refund original passenger (`parentPassengerIds`, Task 13).
 * Everything else `issues` might report — a `FOR:`/ticket-block count mismatch, a `NET CC BILLING`
 * reconciliation failure, low-OCR-confidence text, a dropped flight segment — is a genuinely
 * STRUCTURAL finding with no single field whose edit resolves it, or is something an operator who
 * has read the page image and corrected every visible field may legitimately need to override (a
 * real invoice's total can simply not match what OCR read). Those stay visible in the issues panel
 * as a standing reminder to double-check, but deliberately do not block the INDIVIDUAL Save
 * button. (A reconciliation mismatch DOES exclude an invoice from the "Save all ready" BATCH —
 * see `InvoiceScanPage.tsx`'s `reconciles()` — because that panel only ever renders for the
 * selected invoice, so a batch save can write a misread total with nobody ever seeing the warning;
 * that is a batch-only exclusion, deliberately NOT modelled here in `statusFor`, since it must
 * never block the individual button.)
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
