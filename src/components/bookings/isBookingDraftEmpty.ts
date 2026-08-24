import type { BookingDraftState } from './booking-form';

/**
 * In its own file only so it can be exported for unit testing without booking-form.tsx tripping
 * `react-refresh/only-export-components`. `BookingDraftState` stays there and is imported as a
 * type, so the circular reference is compile-time only.
 *
 * `bookingDate` counts as input only when it DIFFERS from `seededBookingDate` — what this mount
 * started at, captured once. Still equal to the seed means untouched; different means a deliberate
 * back-date, which must count or Cancel silently discards it.
 *
 * Do NOT compare against a live `new Date()`. The seed is a module-level value computed once, so a
 * tab left open across a day rollover would make an untouched form look edited.
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
