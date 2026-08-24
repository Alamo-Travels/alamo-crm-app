import {
  AdjustmentInput,
  CreateBookingInput,
  DuplicateInvoice,
  PaymentInput,
  createAdjustment,
  createBooking,
} from '@/api/bookings.api';
import { duplicateInvoice, errorMessage } from '@/utils/apiError';
import { ReviewInvoice } from './reviewInvoice';

export type SaveOutcome =
  | { kind: 'saved' }
  | { kind: 'duplicate'; duplicate: DuplicateInvoice }
  | { kind: 'failed'; message: string };

/**
 * The review screen's batch payment control: a status and a type, and deliberately **NO amount**.
 *
 * `payment.amount` is a PER-PASSENGER outstanding balance (see the 2026-07-17 per-passenger
 * payment change), so there is no such thing as one shared figure to apply. The page used to hold
 * a single "Amount owed" input and hand the resulting `PaymentInput` to `toCreateBookingInput`,
 * which spread that same object onto every passenger — `500` typed on a three-passenger Pending
 * invoice recorded $1,500 outstanding. The backend's cap is same-document (a passenger's pending
 * must not exceed its OWN `amount`), so a per-passenger figure of 500 against a 4,000 ticket
 * validated cleanly and the wrong money entered the ledger with no warning at all.
 *
 * This mirrors `booking-form.tsx`'s shared-payment mode exactly, which has no shared amount field
 * for the identical reason: **under a shared Pending status each passenger owes its own full ticket
 * price** — which is also the largest value the backend's cap can accept, so it is always valid.
 * A passenger that has genuinely part-paid is edited afterwards through the record-payment dialog,
 * the same as any other invoice in the app.
 */
export interface ScanPaymentDefaults {
  status: 'paid' | 'pending';
  type: 'card' | 'check' | 'cash';
}

/** Paid owes nothing; Pending owes this passenger's own full ticket amount. */
function paymentFor(defaults: ScanPaymentDefaults, amount: number): PaymentInput {
  return {
    status: defaults.status,
    type: defaults.type,
    amount: defaults.status === 'pending' ? amount : 0,
  };
}

function orUndefined(value: string | null): string | undefined {
  return value ?? undefined;
}

/**
 * Maps a reviewed invoice onto the create payload.
 *
 * A Voided invoice keeps ONLY invoice number, booking date and the VOID placeholder passenger —
 * the app records a voided invoice as nothing more, so the parsed trip and amounts are discarded
 * here by design. The detail panel warns before the operator selects Voided.
 */
export function toCreateBookingInput(invoice: ReviewInvoice, payment: ScanPaymentDefaults): CreateBookingInput {
  // A remark is stored PER PASSENGER (2026-07-17), so the invoice-level remark the review screen
  // collects is applied to each of them — including the VOID placeholder, which is the only row a
  // voided invoice has and therefore the only place its "VOID" remark can live.
  const remark = invoice.remark?.trim() ? { remark: invoice.remark.trim() } : {};

  if (invoice.type === 'Voided') {
    return {
      invoiceNumber: invoice.invoiceNumber ?? '',
      bookingDate: invoice.bookingDate ?? '',
      voided: true,
      passengers: [{ passengerName: 'VOID', amount: 0, ...remark }],
    };
  }

  const arrDate = invoice.arrDateChoice === 'final' ? invoice.arrDateFinal : invoice.arrDateReturn;

  return {
    invoiceNumber: invoice.invoiceNumber ?? '',
    bookingDate: invoice.bookingDate ?? '',
    pnr: orUndefined(invoice.pnr),
    airlineCode: orUndefined(invoice.airlineCode),
    depCity: orUndefined(invoice.depCity),
    arrCity: orUndefined(invoice.arrCity),
    depDate: orUndefined(invoice.depDate),
    arrDate: orUndefined(arrDate),
    passengers: invoice.passengers.map((passenger, index) => ({
      passengerName: passenger.name,
      amount: passenger.amount ?? 0,
      customer: invoice.customerIds[index] ?? undefined,
      ...remark,
      // Each passenger gets its OWN balance, never one shared figure — see `ScanPaymentDefaults`.
      payment: paymentFor(payment, passenger.amount ?? 0),
    })),
  };
}

/** Saves one invoice. A 409 duplicate is reported, never silently confirmed. */
export async function saveScannedInvoice(
  invoice: ReviewInvoice,
  payment: ScanPaymentDefaults,
  confirmDuplicate: boolean
): Promise<SaveOutcome> {
  const input = toCreateBookingInput(invoice, payment);
  try {
    await createBooking(confirmDuplicate ? { ...input, confirmDuplicate: true } : input);
    return { kind: 'saved' };
  } catch (err) {
    const duplicate = duplicateInvoice(err);
    if (duplicate) return { kind: 'duplicate', duplicate };
    return { kind: 'failed', message: errorMessage(err, 'Could not save this invoice.') };
  }
}

/**
 * Saves a Reissue/Refund as one adjustment per passenger, each against its own original.
 *
 * `bookingDate` and `pnr` come from the header as for a New invoice; trip fields are sent only
 * when present. The amount is whatever the operator read off the handwriting, since a
 * Reissue/Refund has no printed billing block.
 *
 * Every passenger already has a resolved parent by the time Save is reachable; the `!parentId`
 * check is belt-and-braces.
 *
 * ADJUSTMENTS HAVE NO DUPLICATE 409, so nothing server-side catches a double POST. A multi-
 * passenger invoice posts sequentially and can fail partway, and a failed invoice is retryable, so
 * a naive restart would re-post earlier successes. Two guards: an index with an existing
 * `adjustmentIds` entry is skipped, and `onProgress` fires per passenger so the caller can persist
 * each id immediately rather than only when the loop finishes. It also reports the posted amount,
 * which is what lets the caller warn when an already-posted amount is edited and silently not
 * re-sent.
 */
export async function saveScannedAdjustment(
  invoice: ReviewInvoice,
  payment: ScanPaymentDefaults,
  onProgress?: (index: number, adjustmentId: string, amount: number) => void
): Promise<SaveOutcome> {
  const arrDate = invoice.arrDateChoice === 'final' ? invoice.arrDateFinal : invoice.arrDateReturn;

  try {
    for (const [index, passenger] of invoice.passengers.entries()) {
      // Already created by an earlier attempt on this same invoice — never re-POST it.
      if (invoice.adjustmentIds[index]) continue;

      const parentId = invoice.parentPassengerIds[index];
      if (!parentId) return { kind: 'failed', message: 'Pick the original passenger first.' };

      const input: AdjustmentInput = {
        bookingType: invoice.type === 'Refund' ? 'Refund' : 'Reissue',
        bookingDate: invoice.bookingDate ?? '',
        amount: passenger.amount ?? 0,
        pnr: invoice.pnr ?? '',
        // Per-adjustment balance, same rule as a New invoice's passengers — see
        // `ScanPaymentDefaults`. A Pending adjustment owes its own full amount.
        payment: paymentFor(payment, passenger.amount ?? 0),
        ...(invoice.airlineCode ? { airlineCode: invoice.airlineCode } : {}),
        ...(invoice.depCity ? { depCity: invoice.depCity } : {}),
        ...(invoice.arrCity ? { arrCity: invoice.arrCity } : {}),
        ...(invoice.depDate ? { depDate: invoice.depDate } : {}),
        ...(arrDate ? { arrDate } : {}),
        ...(invoice.remark?.trim() ? { remark: invoice.remark.trim() } : {}),
      };
      const result = await createAdjustment(parentId, input);
      onProgress?.(index, result.id, input.amount);
    }
    return { kind: 'saved' };
  } catch (err) {
    return { kind: 'failed', message: errorMessage(err, 'Could not save this adjustment.') };
  }
}
