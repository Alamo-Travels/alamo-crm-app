import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveScannedAdjustment, saveScannedInvoice, toCreateBookingInput } from './saveScannedInvoice';
import { ReviewInvoice } from './reviewInvoice';
import * as bookings from '@/api/bookings.api';

vi.mock('@/api/bookings.api');

const PAYMENT = { status: 'paid' as const, type: 'card' as const, amount: 0 };

const INVOICE: ReviewInvoice = {
  id: 'scan-0', status: 'ready', pageStart: 1, pageEnd: 2, type: 'New',
  invoiceNumber: '0000249', bookingDate: '2026-07-31', pnr: 'MHNGLM',
  passengers: [{ name: 'JACOB/SHIBIN THOMAS', child: false, amount: 4275.29, ticketNumber: 'EY1', confidence: 96 }],
  segments: [], airlineName: 'ETIHAD AIRWAYS',
  depCityText: 'ATLANTA', arrCityText: 'KOCHI',
  depDate: '2026-11-05', arrDateReturn: '2026-11-26', arrDateFinal: '2026-11-28',
  netCcBilling: 4275.29, issues: [],
  airlineCode: 'EY', depCity: 'ATL', arrCity: 'COK',
  remark: null,
  arrDateChoice: 'return', customerIds: ['c1'], parentPassengerIds: ['p1'], adjustmentIds: [null],
  adjustmentAmounts: [null],
};

const ADJUSTMENT: ReviewInvoice = { ...INVOICE, type: 'Reissue' };

beforeEach(() => {
  vi.mocked(bookings.createBooking).mockReset();
  vi.mocked(bookings.createAdjustment).mockReset();
});

describe('toCreateBookingInput', () => {
  it('maps a New invoice onto the create payload', () => {
    expect(toCreateBookingInput(INVOICE, PAYMENT)).toEqual({
      invoiceNumber: '0000249',
      bookingDate: '2026-07-31',
      pnr: 'MHNGLM',
      airlineCode: 'EY',
      depCity: 'ATL',
      arrCity: 'COK',
      depDate: '2026-11-05',
      arrDate: '2026-11-26',
      passengers: [
        { passengerName: 'JACOB/SHIBIN THOMAS', amount: 4275.29, customer: 'c1', payment: PAYMENT },
      ],
    });
  });

  it('uses the final-leg date when that candidate was chosen', () => {
    const input = toCreateBookingInput({ ...INVOICE, arrDateChoice: 'final' }, PAYMENT);
    expect(input.arrDate).toBe('2026-11-28');
  });

  // Final review, I2: `payment.amount` is a PER-PASSENGER balance. The page used to pass one
  // `PaymentInput` (carrying one typed "Amount owed") and this mapper spread it onto every
  // passenger, so 500 on a 3-passenger invoice recorded $1,500 outstanding — and the backend's
  // same-document cap accepted it silently. Each passenger now owes its OWN full ticket amount,
  // matching `booking-form.tsx`'s shared-payment mode.
  it('gives every passenger its own pending balance rather than one shared figure', () => {
    const multi: ReviewInvoice = {
      ...INVOICE,
      passengers: [
        { name: 'A/ONE', child: false, amount: 100, ticketNumber: null, confidence: 96 },
        { name: 'B/TWO', child: false, amount: 250.5, ticketNumber: null, confidence: 96 },
      ],
      customerIds: ['c1', 'c2'],
    };
    const input = toCreateBookingInput(multi, { status: 'pending', type: 'check' });
    expect(input.passengers.map((p) => p.payment)).toEqual([
      { status: 'pending', type: 'check', amount: 100 },
      { status: 'pending', type: 'check', amount: 250.5 },
    ]);
  });

  it('owes nothing on every passenger when the batch status is Paid', () => {
    const multi: ReviewInvoice = {
      ...INVOICE,
      passengers: [
        { name: 'A/ONE', child: false, amount: 100, ticketNumber: null, confidence: 96 },
        { name: 'B/TWO', child: false, amount: 250.5, ticketNumber: null, confidence: 96 },
      ],
      customerIds: ['c1', 'c2'],
    };
    const input = toCreateBookingInput(multi, { status: 'paid', type: 'card' });
    expect(input.passengers.map((p) => p.payment?.amount)).toEqual([0, 0]);
  });

  // Final review, minor: the spec says a voided invoice retains "Invoice #, Booking Date and
  // Remark" — but no Remark existed anywhere in the review screen, so every voided invoice reached
  // the ledger with a blank remark and nothing recording that it was a void at all.
  it('carries the remark onto the VOID placeholder passenger', () => {
    const input = toCreateBookingInput({ ...INVOICE, type: 'Voided', remark: 'VOID' }, PAYMENT);
    expect(input.passengers).toEqual([{ passengerName: 'VOID', amount: 0, remark: 'VOID' }]);
  });

  it('carries the remark onto every passenger of a New invoice', () => {
    const input = toCreateBookingInput({ ...INVOICE, remark: 'Corporate booking' }, PAYMENT);
    expect(input.passengers[0]).toMatchObject({ remark: 'Corporate booking' });
  });

  it('omits remark entirely when none was entered', () => {
    expect(toCreateBookingInput(INVOICE, PAYMENT).passengers[0]).not.toHaveProperty('remark');
  });

  it('reduces a Voided invoice to invoice number, date and a VOID placeholder', () => {
    const input = toCreateBookingInput({ ...INVOICE, type: 'Voided' }, PAYMENT);
    expect(input).toMatchObject({
      invoiceNumber: '0000249',
      bookingDate: '2026-07-31',
      voided: true,
      passengers: [{ passengerName: 'VOID', amount: 0 }],
    });
    expect(input.pnr).toBeUndefined();
    expect(input.depCity).toBeUndefined();
    // Every other trip field the parser read must ALSO be discarded — asserting only pnr/depCity
    // would miss a regression that re-added just one of the remaining four (arrCity/depDate/
    // arrDate survived and airlineCode didn't, say) and still pass.
    expect(input.airlineCode).toBeUndefined();
    expect(input.arrCity).toBeUndefined();
    expect(input.depDate).toBeUndefined();
    expect(input.arrDate).toBeUndefined();
  });
});

describe('saveScannedInvoice', () => {
  it('reports success', async () => {
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000249', passengers: [] });
    await expect(saveScannedInvoice(INVOICE, PAYMENT, false)).resolves.toEqual({ kind: 'saved' });
  });

  it('surfaces a duplicate warning rather than saving blindly', async () => {
    const duplicate = { id: 'b9', invoiceNumber: '0000249', bookingDate: '2026-07-31', pnr: 'MHNGLM', passengerNames: ['X'] };
    vi.mocked(bookings.createBooking).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: { code: 'DUPLICATE_BOOKING_WARNING', duplicate } } },
    });

    await expect(saveScannedInvoice(INVOICE, PAYMENT, false)).resolves.toEqual({ kind: 'duplicate', duplicate });
  });

  it('re-sends with confirmDuplicate when the operator saves anyway', async () => {
    vi.mocked(bookings.createBooking).mockResolvedValue({ id: 'b1', invoiceNumber: '0000249', passengers: [] });
    await saveScannedInvoice(INVOICE, PAYMENT, true);
    expect(bookings.createBooking).toHaveBeenCalledWith(expect.objectContaining({ confirmDuplicate: true }));
  });

  it('reports the backend message on any other failure', async () => {
    vi.mocked(bookings.createBooking).mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: { message: 'pnr is required' } } },
    });
    await expect(saveScannedInvoice(INVOICE, PAYMENT, false)).resolves.toEqual({
      kind: 'failed',
      message: 'pnr is required',
    });
  });
});

describe('saveScannedAdjustment', () => {
  it('creates one adjustment against the resolved original passenger', async () => {
    vi.mocked(bookings.createAdjustment).mockResolvedValue({
      id: 'a1', bookingType: 'Reissue', parentRef: 'p1', amount: 4275.29,
    });

    await expect(saveScannedAdjustment(ADJUSTMENT, PAYMENT)).resolves.toEqual({ kind: 'saved' });

    expect(bookings.createAdjustment).toHaveBeenCalledWith('p1', {
      bookingType: 'Reissue',
      bookingDate: '2026-07-31',
      amount: 4275.29,
      pnr: 'MHNGLM',
      payment: PAYMENT,
      airlineCode: 'EY',
      depCity: 'ATL',
      arrCity: 'COK',
      depDate: '2026-11-05',
      arrDate: '2026-11-26',
    });
  });

  it('maps Refund type through, and uses the final-leg date when that candidate was chosen', async () => {
    vi.mocked(bookings.createAdjustment).mockResolvedValue({
      id: 'a1', bookingType: 'Refund', parentRef: 'p1', amount: 4275.29,
    });

    await saveScannedAdjustment({ ...ADJUSTMENT, type: 'Refund', arrDateChoice: 'final' }, PAYMENT);

    expect(bookings.createAdjustment).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ bookingType: 'Refund', arrDate: '2026-11-28' })
    );
  });

  it('omits trip fields that were never resolved, since they are optional on the model', async () => {
    vi.mocked(bookings.createAdjustment).mockResolvedValue({
      id: 'a1', bookingType: 'Reissue', parentRef: 'p1', amount: 4275.29,
    });

    await saveScannedAdjustment(
      { ...ADJUSTMENT, airlineCode: null, depCity: null, arrCity: null, depDate: null, arrDateReturn: null, arrDateFinal: null },
      PAYMENT
    );

    const [, input] = vi.mocked(bookings.createAdjustment).mock.calls[0];
    expect(input.airlineCode).toBeUndefined();
    expect(input.depCity).toBeUndefined();
    expect(input.arrCity).toBeUndefined();
    expect(input.depDate).toBeUndefined();
    expect(input.arrDate).toBeUndefined();
  });

  it('refuses to save a row with no resolved original passenger, rather than sending a bogus id', async () => {
    await expect(saveScannedAdjustment({ ...ADJUSTMENT, parentPassengerIds: [null] }, PAYMENT)).resolves.toEqual({
      kind: 'failed',
      message: 'Pick the original passenger first.',
    });
    expect(bookings.createAdjustment).not.toHaveBeenCalled();
  });

  it('reports the backend message on failure', async () => {
    vi.mocked(bookings.createAdjustment).mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: { message: 'amount must be greater than 0' } } },
    });

    await expect(saveScannedAdjustment(ADJUSTMENT, PAYMENT)).resolves.toEqual({
      kind: 'failed',
      message: 'amount must be greater than 0',
    });
  });

  it('saves each passenger against its own original independently', async () => {
    vi.mocked(bookings.createAdjustment).mockResolvedValue({
      id: 'a1', bookingType: 'Reissue', parentRef: 'p1', amount: 100,
    });
    const multi: ReviewInvoice = {
      ...ADJUSTMENT,
      passengers: [
        { name: 'JACOB/SHIBIN THOMAS', child: false, amount: 100, ticketNumber: 'EY1', confidence: 96 },
        { name: 'PAUL/MICHAELA ROSE', child: true, amount: 200, ticketNumber: 'EY2', confidence: 96 },
      ],
      parentPassengerIds: ['p1', 'p2'],
      adjustmentIds: [null, null],
      adjustmentAmounts: [null, null],
    };

    await saveScannedAdjustment(multi, PAYMENT);

    expect(bookings.createAdjustment).toHaveBeenCalledTimes(2);
    expect(bookings.createAdjustment).toHaveBeenNthCalledWith(1, 'p1', expect.objectContaining({ amount: 100 }));
    expect(bookings.createAdjustment).toHaveBeenNthCalledWith(2, 'p2', expect.objectContaining({ amount: 200 }));
  });

  // Critical 2 (fix round 1): adjustments have no duplicate-invoice 409 the way New bookings do,
  // so nothing but the client stops a retried save from re-POSTing a passenger whose adjustment
  // already succeeded on an earlier, partially-failed attempt.
  it('does not re-post an adjustment that already succeeded on an earlier attempt', async () => {
    vi.mocked(bookings.createAdjustment).mockResolvedValue({
      id: 'a2', bookingType: 'Reissue', parentRef: 'p2', amount: 200,
    });
    const retryInvoice: ReviewInvoice = {
      ...ADJUSTMENT,
      passengers: [
        { name: 'JACOB/SHIBIN THOMAS', child: false, amount: 100, ticketNumber: 'EY1', confidence: 96 },
        { name: 'PAUL/MICHAELA ROSE', child: true, amount: 200, ticketNumber: 'EY2', confidence: 96 },
      ],
      parentPassengerIds: ['p1', 'p2'],
      // Passenger 1 already succeeded on a PRIOR attempt (passenger 2 threw that time) — this is
      // exactly the state InvoiceScanPage persists via `saveScannedAdjustment`'s `onProgress`.
      adjustmentIds: ['a1', null],
      adjustmentAmounts: [100, null],
    };

    const outcome = await saveScannedAdjustment(retryInvoice, PAYMENT);

    expect(outcome).toEqual({ kind: 'saved' });
    expect(bookings.createAdjustment).toHaveBeenCalledTimes(1);
    expect(bookings.createAdjustment).toHaveBeenCalledWith('p2', expect.objectContaining({ amount: 200 }));
  });

  it('reports each successful adjustment id via onProgress as it happens, before the whole invoice finishes', async () => {
    vi.mocked(bookings.createAdjustment)
      .mockResolvedValueOnce({ id: 'a1', bookingType: 'Reissue', parentRef: 'p1', amount: 100 })
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 400, data: { error: { message: 'boom' } } },
      });
    const onProgress = vi.fn();
    const multi: ReviewInvoice = {
      ...ADJUSTMENT,
      passengers: [
        { name: 'JACOB/SHIBIN THOMAS', child: false, amount: 100, ticketNumber: 'EY1', confidence: 96 },
        { name: 'PAUL/MICHAELA ROSE', child: true, amount: 200, ticketNumber: 'EY2', confidence: 96 },
      ],
      parentPassengerIds: ['p1', 'p2'],
      adjustmentIds: [null, null],
      adjustmentAmounts: [null, null],
    };

    const outcome = await saveScannedAdjustment(multi, PAYMENT, onProgress);

    expect(outcome).toEqual({ kind: 'failed', message: 'boom' });
    // Passenger 1's success was reported even though passenger 2 subsequently failed — this is
    // what lets the caller persist it BEFORE the invoice's overall outcome is known. The reported
    // amount (100) is passenger 1's own — fix round 2 threads this through so the page can later
    // detect a stale edit (see `adjustmentAmounts`'s doc comment).
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(0, 'a1', 100);
  });
});
