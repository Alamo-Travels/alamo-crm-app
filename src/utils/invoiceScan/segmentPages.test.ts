import { describe, expect, it } from 'vitest';
import { segmentPages, UNREADABLE_PAGE_MARKER } from './segmentPages';
import { OcrPage } from './types';

function page(pageNumber: number, ...lines: string[]): OcrPage {
  return { pageNumber, lines, words: [] };
}

const HEADER_01 = 'CUSTOMER NBR: 2812613000              MHNGLM               PAGE: 01';
const HEADER_02 = 'CUSTOMER NBR: 2812613000              MHNGLM               PAGE: 02';

describe('segmentPages', () => {
  it('starts a new invoice at every PAGE: 01', () => {
    const result = segmentPages([
      page(1, HEADER_01, 'FOR: A/B'),
      page(2, HEADER_02, 'SUB TOTAL'),
      page(3, HEADER_01, 'FOR: C/D'),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(result[1].map((p) => p.pageNumber)).toEqual([3]);
  });

  it('tolerates an unpadded page number', () => {
    const result = segmentPages([page(1, 'PAGE: 1'), page(2, 'PAGE: 2')]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2);
  });

  it('treats leading pages with no PAGE: 01 as one invoice rather than dropping them', () => {
    const result = segmentPages([page(1, 'PAGE: 02'), page(2, HEADER_01)]);
    expect(result).toHaveLength(2);
    expect(result[0].map((p) => p.pageNumber)).toEqual([1]);
  });

  it('returns nothing for no pages', () => {
    expect(segmentPages([])).toEqual([]);
  });

  // An unreadable page (no OCR
  // text at all, so it can never carry a `PAGE: 01` line) must still start a new group. Without
  // this, an unreadable page that WAS an invoice's boundary silently folds itself — and every
  // real page after it up to the next detected boundary — into the PRECEDING invoice, and the
  // invoice that should have started there never appears in the output at all.
  describe('unreadable pages (scanPdf render/OCR failures)', () => {
    it('treats an unreadable page as a boundary, splitting it from the preceding group', () => {
      const result = segmentPages([page(1, HEADER_01, 'FOR: A/B'), page(2, UNREADABLE_PAGE_MARKER)]);

      expect(result).toHaveLength(2);
      expect(result[0].map((p) => p.pageNumber)).toEqual([1]);
      expect(result[1].map((p) => p.pageNumber)).toEqual([2]);
    });

    it('groups subsequent non-boundary pages with the unreadable page, not the invoice before it', () => {
      const result = segmentPages([
        page(1, HEADER_01, 'FOR: A/B'),
        page(2, UNREADABLE_PAGE_MARKER),
        page(3, 'FOR: C/D'),
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].map((p) => p.pageNumber)).toEqual([1]);
      expect(result[1].map((p) => p.pageNumber)).toEqual([2, 3]);
    });

    it('splits two consecutive unreadable pages into two singleton groups', () => {
      const result = segmentPages([
        page(1, HEADER_01),
        page(2, UNREADABLE_PAGE_MARKER),
        page(3, UNREADABLE_PAGE_MARKER),
      ]);

      expect(result).toHaveLength(3);
      expect(result.map((group) => group.map((p) => p.pageNumber))).toEqual([[1], [2], [3]]);
    });
  });
});

describe('OCR damage to the PAGE: 01 boundary', () => {
  // MEASURED on testDocs/TestInvoices.pdf: pages 4 and 10 OCR'd their leading zero as the LETTER
  // O ("PAGE: O01"). The strict pattern missed both boundaries, so invoices 0000253 and 0000257
  // were absorbed into their predecessors and never reached the ledger at all - while the merged
  // record still reconciled and looked ready to save. Silent loss of a whole invoice is the worst
  // failure this feature has, so the tolerance is not optional.
  it('treats PAGE: O01 as a first page, with the zero misread as a letter O', () => {
    const groups = segmentPages([
      page(1, 'ITINERARY/INVOICE NO. 0000252', 'CUSTOMER NBR: 2812613000 KEHVES PAGE: 01'),
      page(2, 'CONTINUED'),
      page(3, 'ITINERARY/INVOICE NO. 0000253', 'CUSTOMER NBR: 2812613000 OXKLKT PAGE: O01'),
      page(4, 'CONTINUED'),
    ]);
    expect(groups.map((g) => g.map((p) => p.pageNumber))).toEqual([[1, 2], [3, 4]]);
  });

  it('still does not treat a later page as a boundary', () => {
    const groups = segmentPages([
      page(1, 'PAGE: 01'),
      page(2, 'PAGE: 02'),
      page(3, 'PAGE: O2'),
      page(4, 'PAGE: 11'),
    ]);
    expect(groups).toHaveLength(1);
  });
});
