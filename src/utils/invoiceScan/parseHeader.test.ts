import { describe, expect, it } from 'vitest';
import { parseHeader, parseInvoiceDate } from './parseHeader';
import { OcrPage } from './types';

function pageOf(...lines: string[]): OcrPage {
  return { pageNumber: 1, lines, words: [] };
}

const ORIGINAL = pageOf(
  'SALES PERSON: BC       ITINERARY/INVOICE NO. 0000249        DATE: 31 JUL 26',
  'CUSTOMER NBR: 2812613000              MHNGLM               PAGE: 01'
);

describe('parseInvoiceDate', () => {
  it('reads DD MMM YY as 20YY', () => {
    expect(parseInvoiceDate('31 JUL 26')).toBe('2026-07-31');
    expect(parseInvoiceDate('05 NOV 26')).toBe('2026-11-05');
    expect(parseInvoiceDate('26 MAR 27')).toBe('2027-03-26');
  });

  it('accepts an unpadded day', () => {
    expect(parseInvoiceDate('5 NOV 26')).toBe('2026-11-05');
  });

  it('rejects an unknown month', () => {
    expect(parseInvoiceDate('31 XXX 26')).toBeNull();
  });

  it('rejects out-of-range day (88)', () => {
    expect(parseInvoiceDate('88 JUL 26')).toBeNull();
  });

  it('rejects day 00', () => {
    expect(parseInvoiceDate('00 JUL 26')).toBeNull();
  });

  it('rejects day 32', () => {
    expect(parseInvoiceDate('32 JUL 26')).toBeNull();
  });
});

describe('parseHeader', () => {
  it('reads invoice number, date and PNR from the sample header', () => {
    expect(parseHeader([ORIGINAL])).toEqual({
      invoiceNumber: '0000249',
      bookingDate: '2026-07-31',
      pnr: 'MHNGLM',
      isAdjustment: false,
    });
  });

  it('keeps the invoice number verbatim, leading zeros included', () => {
    expect(parseHeader([ORIGINAL]).invoiceNumber).toBe('0000249');
  });

  it('treats a missing invoice number as an adjustment', () => {
    const result = parseHeader([
      pageOf('SALES PERSON: BC                                  DATE: 29 JUL 26',
             'CUSTOMER NBR: 2812613000              YKHRUA               PAGE: 01'),
    ]);
    expect(result.invoiceNumber).toBeNull();
    expect(result.isAdjustment).toBe(true);
    expect(result.pnr).toBe('YKHRUA');
  });

  it('treats an all-zeros invoice number as an adjustment', () => {
    const result = parseHeader([
      pageOf('ITINERARY/INVOICE NO. 0000000        DATE: 29 JUL 26',
             'CUSTOMER NBR: 2812613000              YKHRUA               PAGE: 01'),
    ]);
    expect(result.isAdjustment).toBe(true);
  });

  it('rejects a blank invoice number field even with digits immediately following (discriminating case)', () => {
    // Blank invoice field followed by date value directly (OCR lost the DATE: label)
    const result = parseHeader([
      pageOf('ITINERARY/INVOICE NO.               29 JUL 26',
             'CUSTOMER NBR: 2812613000              YKHRUA               PAGE: 01'),
    ]);
    // Must not capture "29" as a bogus invoice number
    expect(result.invoiceNumber).toBeNull();
    expect(result.isAdjustment).toBe(true);
  });

  it('captures an 8-digit invoice number whole, not truncated', () => {
    const result = parseHeader([
      pageOf('ITINERARY/INVOICE NO. 00000249        DATE: 31 JUL 26',
             'CUSTOMER NBR: 2812613000              MHNGLM               PAGE: 01'),
    ]);
    expect(result.invoiceNumber).toBe('00000249');
    expect(result.isAdjustment).toBe(false);
  });

  it('treats a blank invoice number with DATE label still present as an adjustment', () => {
    const result = parseHeader([
      pageOf('ITINERARY/INVOICE NO.               DATE: 29 JUL 26',
             'CUSTOMER NBR: 2812613000              YKHRUA               PAGE: 01'),
    ]);
    expect(result.invoiceNumber).toBeNull();
    expect(result.isAdjustment).toBe(true);
    expect(result.bookingDate).toBe('2026-07-29');
  });

  it('does not mistake the customer number for the PNR', () => {
    expect(parseHeader([ORIGINAL]).pnr).not.toBe('2812613000');
  });

  it('returns nulls when the header is unreadable', () => {
    expect(parseHeader([pageOf('complete garbage')])).toEqual({
      invoiceNumber: null,
      bookingDate: null,
      pnr: null,
      isAdjustment: true,
    });
  });
});
