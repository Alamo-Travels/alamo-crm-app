import type { BookingDraftState } from './booking-form';

/**
 * Split into its own file (rather than living inline in booking-form.tsx, where it originally
 * lived) purely so it can be `export`ed for direct unit testing — see the "seeded-bookingDate
 * regression (M3 fix)" describe block in `booking-form.draft.test.tsx` — without booking-form.tsx
 * (a component file whose sole intended export is `BookingForm`) picking up a
 * `react-refresh/only-export-components` lint warning for exporting a non-component value
 * alongside it. `BookingDraftState` (an interface, erased at compile time, so it carries no such
 * warning either way) stays defined in booking-form.tsx and is imported here as a type only —
 * this is a compile-time-only circular reference between the two files, not a runtime one, and is
 * safe. Nothing here behaves any differently than it did inline.
 *
 * `bookingDate` IS consulted, but only relative to `seededBookingDate` — what THIS MOUNT'S form
 * actually started at (captured once, in `BookingForm`, via `seededBookingDateRef`), never a
 * freshly-computed "today". A value that still equals the seed is the untouched default, not
 * evidence that anyone typed anything; a value that DIFFERS from its own seed (e.g. a back-dated
 * historic invoice) is real, deliberate input and must count, or changing only the date and
 * pressing Cancel silently discards it with no confirmation.
 *
 * REGRESSION THIS AVOIDS: an earlier version compared against a live `new Date().toISOString()`
 * instead. `form.bookingDate` on a fresh CREATE form is seeded from `emptyForm.bookingDate`, a
 * MODULE-LEVEL value computed ONCE when booking-form.tsx first loads — it is never refreshed. If
 * the SPA tab stays open across a UTC day rollover with no reload (very plausible for an all-day
 * office CRM), a genuinely untouched form's `bookingDate` stays frozen at yesterday while a live
 * "today" ticks forward, and the two would differ — a false "touched" reached by a different route
 * than the bug this predicate was originally written to fix. Comparing against what THIS mount
 * actually seeded, captured once and never recomputed, is immune to both that staleness and any
 * day rollover: "differs from what we started with" is the precise meaning of "the user changed
 * it", independent of the wall clock entirely.
 */
export function isBookingDraftEmpty(state: BookingDraftState, seededBookingDate: string): boolean {
  const f = state.form;
  const headerTouched = Boolean(
    f.invoiceNumber ||
      f.pnr ||
      f.airlineCode ||
      f.depCity ||
      f.arrCity ||
      f.depDate ||
      f.arrDate ||
      f.voided ||
      f.bookingDate !== seededBookingDate
  );
  // A per-row payment status/type that differs from a fresh row's default ('paid'/'card', mirroring
  // booking-form.tsx's `EMPTY_PASSENGER` — inlined as literals here, rather than importing that
  // value, for the same react-refresh reason described above; if those defaults ever change, this
  // must change with them) is real content even when shareAll is off and nothing else on the row
  // was touched — e.g. a user who only flips one passenger's Payment Type to "Check" has done work
  // that must not be silently discarded on Cancel.
  const passengersTouched = state.passengers.some(
    (p) =>
      p.name ||
      p.amount ||
      p.customer ||
      p.remark ||
      p.pendingAmount ||
      p.paymentStatus !== 'paid' ||
      p.paymentType !== 'card'
  );
  const sharedTouched =
    Boolean(state.shared.remark) ||
    state.shared.paymentStatus !== 'paid' ||
    state.shared.paymentType !== 'card';
  // A typed total is content in its own right — `totalAmount` starts '' on a fresh create form
  // (see `totalAmountFrom`) and only becomes non-blank once the user actually types into it.
  const totalAmountTouched = Boolean(state.totalAmount.trim());
  return !headerTouched && !passengersTouched && !sharedTouched && !totalAmountTouched;
}
