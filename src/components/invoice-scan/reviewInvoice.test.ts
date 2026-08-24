import { describe, expect, it } from 'vitest';
import { statusFor } from './reviewInvoice';
import { ScannedPassenger } from '@/utils/invoiceScan/types';

function passenger(amount: number | null): ScannedPassenger {
  return { name: 'Doe/Jane', child: false, amount, ticketNumber: 'T1', confidence: 96 };
}

// A fully-complete New invoice's fields, spread into each fixture below and overridden by the one
// field each test actually varies — keeps every test isolated to the ONE condition it claims to
// prove, rather than incidentally passing/failing because of an unrelated blank field.
const COMPLETE = { customerIds: ['c1'], type: 'New' as const, parentPassengerIds: [], pnr: 'MHNGLM', airlineCode: 'EY' };

describe('statusFor', () => {
  // `issues` (the frozen, scan-time OCR findings) is now ADVISORY DISPLAY TEXT ONLY,
  // never a save gate — see reviewInvoice.ts's doc comment for the full reasoning. Before this, ANY
  // scan-time issue — including "N passenger amounts could not be read", the single most common
  // OCR finding, measured at roughly 1 in 6 — froze the invoice at 'attention' FOREVER, even after
  // the operator typed in the correct figure, because nothing ever recomputed `issues`. This test
  // locks in the corrected contract: `statusFor` no longer even takes `issues` as an input, and an
  // invoice with complete live data (linked, priced, PNR + airline present) is 'ready' regardless
  // of what `issues` any caller might separately be displaying.
  it('is ready once linked and every amount is present, independent of any advisory issue text', () => {
    expect(statusFor({ ...COMPLETE, passengers: [passenger(100)] })).toBe('ready');
  });

  // THE central live-recomputed gate: a null passenger amount blocks
  // Ready — and, critically, unblocks the moment the operator types a real figure (proven by the
  // companion test right below, same invoice shape, differing only in `amount`).
  it('flags a non-Voided invoice with an unread/blank passenger amount as needing attention', () => {
    expect(statusFor({ ...COMPLETE, passengers: [passenger(null)] })).toBe('attention');
  });

  it('is ready once that same invoice gets a real amount typed in — the live re-derivation', () => {
    expect(statusFor({ ...COMPLETE, passengers: [passenger(275.5)] })).toBe('ready');
  });

  // The `type !== 'Voided'` exemption: Voided never needs a customer link, a real passenger
  // amount, a PNR, or an airline code (it saves only a placeholder passenger with none of those
  // fields — see `saveScannedInvoice.ts`'s Voided branch) — none of them may push it to
  // 'attention'.
  it('does not require a customer link, a real amount, a PNR, or an airline code on a Voided invoice', () => {
    expect(
      statusFor({
        customerIds: [null],
        type: 'Voided',
        parentPassengerIds: [null],
        passengers: [passenger(null)],
        pnr: null,
        airlineCode: null,
      })
    ).toBe('ready');
  });

  it('is ready when every passenger is linked and has a real amount', () => {
    expect(
      statusFor({ ...COMPLETE, customerIds: ['c1', 'c2'], passengers: [passenger(100), passenger(200)] })
    ).toBe('ready');
  });

  it('flags a non-Voided invoice with an unlinked passenger as needing attention', () => {
    expect(statusFor({ ...COMPLETE, customerIds: [null], passengers: [passenger(100)] })).toBe('attention');
  });

  // --- pnr/airlineCode, gated live against the backend's ACTUAL refine ------------------------
  // (`createBookingSchema`: `voided || (pnr && airlineCode)`; the Adjustment schema requires `pnr`
  // unconditionally but leaves `airlineCode` optional — see reviewInvoice.ts's doc comment.)

  it('flags a New invoice with no PNR as needing attention, even fully linked, priced, and with a resolved airline', () => {
    expect(statusFor({ ...COMPLETE, passengers: [passenger(100)], pnr: null })).toBe('attention');
  });

  it('is ready once that same invoice gets its PNR filled in', () => {
    expect(statusFor({ ...COMPLETE, passengers: [passenger(100)], pnr: 'MHNGLM' })).toBe('ready');
  });

  // THE central case: `airlineCode` is never auto-resolved before this
  // (see InvoiceScanPage.tsx's new resolution effect) — a New invoice missing it must be blocked
  // even though everything else (link, amount, PNR) is complete, or "Save all ready" 400s at the
  // backend's refine on every single New invoice.
  it('flags a New invoice with no resolved airline as needing attention, even fully linked, priced, and with a PNR', () => {
    expect(statusFor({ ...COMPLETE, passengers: [passenger(100)], airlineCode: null })).toBe('attention');
  });

  it('is ready once that same invoice gets its airline resolved — the live re-derivation', () => {
    expect(statusFor({ ...COMPLETE, passengers: [passenger(100)], airlineCode: 'EY' })).toBe('ready');
  });

  // The backend's Adjustment schema does NOT require airlineCode (see the doc comment) — a
  // Reissue/Refund must NOT be gated on it, proving the `type === 'New'` guard on that check
  // actually discriminates by type rather than firing for any non-Voided invoice.
  it('does not require an airline code for a Reissue, unlike a New invoice', () => {
    expect(
      statusFor({
        customerIds: ['c1'],
        type: 'Reissue',
        parentPassengerIds: ['p1'],
        passengers: [passenger(100)],
        pnr: 'MHNGLM',
        airlineCode: null,
      })
    ).toBe('ready');
  });

  // But the Adjustment schema DOES require `pnr` unconditionally — a Reissue/Refund missing it
  // must still be blocked, same as New.
  it('still requires a PNR for a Reissue, same as a New invoice', () => {
    expect(
      statusFor({
        customerIds: ['c1'],
        type: 'Reissue',
        parentPassengerIds: ['p1'],
        passengers: [passenger(100)],
        pnr: null,
        airlineCode: null,
      })
    ).toBe('attention');
  });

  // --- Reissue/Refund parent-passenger gating -------------------------------------------------

  it('flags a Reissue as needing attention while its original passenger is unresolved, even when linked and priced', () => {
    expect(
      statusFor({ ...COMPLETE, type: 'Reissue', parentPassengerIds: [null], passengers: [passenger(100)] })
    ).toBe('attention');
  });

  it('flags a Refund the same way as a Reissue — unresolved parent blocks Ready', () => {
    expect(
      statusFor({ ...COMPLETE, type: 'Refund', parentPassengerIds: [null], passengers: [passenger(100)] })
    ).toBe('attention');
  });

  it('is ready once a Reissue is linked, priced, AND every row has a resolved original passenger', () => {
    expect(
      statusFor({
        ...COMPLETE,
        type: 'Reissue',
        customerIds: ['c1', 'c2'],
        parentPassengerIds: ['p1', 'p2'],
        passengers: [passenger(100), passenger(200)],
      })
    ).toBe('ready');
  });

  // A New invoice must NOT be gated by parentPassengerIds at all — that field is meaningless for
  // it (adjustments attach to a New passenger, a New invoice doesn't attach to anything). Proves
  // the `(type === 'Reissue' || type === 'Refund')` guard actually discriminates by type, rather
  // than the parentPassengerIds check firing unconditionally for any non-Voided invoice.
  it('does not gate a New invoice on parentPassengerIds', () => {
    expect(statusFor({ ...COMPLETE, parentPassengerIds: [null], passengers: [passenger(100)] })).toBe('ready');
  });
});
