import { describe, expect, it } from 'vitest';
import { parseScannedInvoices } from './parseInvoice';
import { OcrPage, OcrWord } from './types';

function pageOf(pageNumber: number, ...lines: string[]): OcrPage {
  return { pageNumber, lines, words: [] };
}

/** A minimal OcrWord at a given confidence — position doesn't matter for the low-confidence guard. */
function wordAt(confidence: number): OcrWord {
  return { text: 'x', left: 0, top: 0, right: 1, bottom: 1, confidence, line: 0 };
}

/** Same page, with a real `words` array attached — for testing the low-confidence guard, which
 *  every other fixture in this file (via `pageOf`) deliberately leaves empty. */
function withWords(page: OcrPage, words: OcrWord[]): OcrPage {
  return { ...page, words };
}

const LOW_CONFIDENCE_ISSUE = 'Some text was read with low confidence — check every field';

const INVOICE_A = [
  pageOf(1,
    'SALES PERSON: BC   ITINERARY/INVOICE NO. 0000249   DATE: 31 JUL 26',
    'CUSTOMER NBR: 2812613000        MHNGLM             PAGE: 01',
    'FOR: JACOB/SHIBIN THOMAS',
    '',
    '05 NOV 26  -  THURSDAY',
    '   AIR   ETIHAD AIRWAYS   FLT:14   BUSINESS',
    '         LV ATLANTA               920P',
    '         AR KOCHI                 755A',
    'AIR TICKET   EY7545281549       JACOB SHIBIN THOMAS',
    'ELEC TKT                        BILLED TO VIXXXX3780      4,275.29*'),
  pageOf(2,
    'CUSTOMER NBR: 2812613000        MHNGLM             PAGE: 02',
    'NET CC BILLING     4,275.29*'),
];

const ADJUSTMENT = [
  pageOf(3,
    'SALES PERSON: BC                            DATE: 01 AUG 26',
    'CUSTOMER NBR: 2812613000        ABCDEF             PAGE: 01',
    'FOR: SMITH/JANE',
    '',
    '05 NOV 26  -  THURSDAY',
    '   AIR   ETIHAD AIRWAYS   FLT:14   BUSINESS',
    '         LV ATLANTA               920P',
    '         AR KOCHI                 755A'),
];

describe('parseScannedInvoices', () => {
  it('splits a stack and records each invoice page range', () => {
    const result = parseScannedInvoices([...INVOICE_A, ...ADJUSTMENT]);
    expect(result).toHaveLength(2);
    expect(result[0].pageStart).toBe(1);
    expect(result[0].pageEnd).toBe(2);
    expect(result[1].pageStart).toBe(3);
    expect(result[1].pageEnd).toBe(3);
  });

  it('assembles a complete New invoice with no issues', () => {
    const invoice = parseScannedInvoices(INVOICE_A)[0];
    expect(invoice.type).toBe('New');
    expect(invoice.invoiceNumber).toBe('0000249');
    expect(invoice.bookingDate).toBe('2026-07-31');
    expect(invoice.pnr).toBe('MHNGLM');
    expect(invoice.passengers).toHaveLength(1);
    expect(invoice.depCityText).toBe('ATLANTA');
    expect(invoice.issues).toEqual([]);
  });

  it('defaults an invoice with no number to Reissue', () => {
    const invoice = parseScannedInvoices(ADJUSTMENT)[0];
    expect(invoice.type).toBe('Reissue');
    expect(invoice.invoiceNumber).toBeNull();
  });

  it('flags an adjustment for the operator to confirm its type and amount', () => {
    const invoice = parseScannedInvoices(ADJUSTMENT)[0];
    expect(invoice.issues).toContain('Confirm Reissue or Refund and enter the amount from the handwriting');
  });

  it('flags a New invoice missing a PNR', () => {
    const noPnr = [
      pageOf(1,
        'ITINERARY/INVOICE NO. 0000249   DATE: 31 JUL 26',
        'PAGE: 01',
        'FOR: A/B',
        '',
        'AIR TICKET  X1  A B',
        'ELEC TKT  BILLED TO VI1   10.00*',
        'NET CC BILLING  10.00*'),
    ];
    expect(parseScannedInvoices(noPnr)[0].issues).toContain('No PNR found');
  });

  it('merges issues from every parsing stage', () => {
    const invoice = parseScannedInvoices([pageOf(1, 'PAGE: 01', 'garbage')])[0];
    expect(invoice.issues).toContain('No passenger names found');
    expect(invoice.issues).toContain('No flight segments found');
  });

  describe('low OCR confidence', () => {
    // Regression test for a shipped Critical: a word scored exactly 0 — a real, ordinary
    // Tesseract score for a badly garbled character, and the WORST class of read — must raise
    // this issue same as any other low-confidence word. It must never be treated as an "empty
    // token" to skip: Tesseract emits no word at all where it found no text, so there is no
    // legitimate 0-means-nothing case to guard against.
    it('flags an invoice with a confidence-0 word', () => {
      const pages = [withWords(INVOICE_A[0], [wordAt(0)]), INVOICE_A[1]];
      const invoice = parseScannedInvoices(pages)[0];
      expect(invoice.issues).toContain(LOW_CONFIDENCE_ISSUE);
    });

    it('flags a word just below the confidence threshold', () => {
      const pages = [withWords(INVOICE_A[0], [wordAt(69)]), INVOICE_A[1]];
      const invoice = parseScannedInvoices(pages)[0];
      expect(invoice.issues).toContain(LOW_CONFIDENCE_ISSUE);
    });

    it('does not flag a word at or above the confidence threshold', () => {
      const pages = [withWords(INVOICE_A[0], [wordAt(70)]), INVOICE_A[1]];
      const invoice = parseScannedInvoices(pages)[0];
      expect(invoice.issues).not.toContain(LOW_CONFIDENCE_ISSUE);
    });

    it('keeps an invoice Ready when no words are low-confidence', () => {
      const pages = [withWords(INVOICE_A[0], [wordAt(70), wordAt(85), wordAt(100)]), INVOICE_A[1]];
      const invoice = parseScannedInvoices(pages)[0];
      expect(invoice.issues).toEqual([]);
    });
  });
});
