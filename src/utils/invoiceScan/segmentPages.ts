import { OcrPage } from './types';

/**
 * `PAGE: 01` in the header. Tolerates an unpadded `PAGE: 1`, stray spacing, and the glyph
 * confusions MEASURED on real scans: the leading zero read as a letter `O`, and the `1` read as
 * `l`/`I`.
 *
 * The `O` tolerance is not cosmetic. On testDocs/TestInvoices.pdf two pages OCR'd as `PAGE: O01`,
 * the strict pattern missed both boundaries, and the two invoices that began there were absorbed
 * into their predecessors and never created — while the merged record still reconciled against
 * NET CC BILLING and presented as ready to save. A missed boundary silently destroys an invoice;
 * a spurious one produces an obviously-partial extra record. Erring toward tolerance is therefore
 * correct here, and matches this file's existing "merging wrongly is invisible" reasoning.
 *
 * `\s*` anchors the digits immediately after the colon, so a genuine later page still cannot
 * match: `PAGE: 02` fails outright, and in `PAGE: 11` there is no word boundary after the first
 * `1` and nothing may be skipped to reach the second.
 */
const FIRST_PAGE = /\bPAGE:\s*[O0]*[1lI]\b/;

/**
 * Sentinel line `scanPdf` writes as the sole line of a page it could not render or OCR (see
 * `ocr/scanPdf.ts`). If an unreadable page happened to be an invoice's `PAGE: 01` boundary, that
 * fact is unrecoverable — there is no OCR text left to detect it from. Treating an unreadable
 * page as a boundary UNCONDITIONALLY (below) is deliberate: the alternative (only splitting when
 * `PAGE: 01` is actually found) would silently fold the unreadable page, and every real page
 * after it up to the next detected `PAGE: 01`, into the PRECEDING invoice — an entire invoice's
 * worth of data absorbed into another with no trace beyond one generic issue on the wrong record.
 * Splitting unconditionally can at worst over-segment a page that was really just a mid-invoice
 * continuation, producing an extra, clearly-flagged partial invoice — visible and correctable.
 * Merging wrongly is invisible.
 */
export const UNREADABLE_PAGE_MARKER = '[[UNREADABLE PAGE]]';

/**
 * Splits a scanned stack into one page-group per invoice.
 *
 * Keys on `PAGE: 01`, NOT on the invoice number — Reissue/Refund invoices carry no number and
 * must still segment correctly. Pages before the first `PAGE: 01` (a stack that starts
 * mid-invoice) become their own group rather than being discarded, so nothing is silently lost.
 * An unreadable page (`UNREADABLE_PAGE_MARKER`) is ALSO always treated as a boundary, for the
 * same "never silently lose data" reason — see the marker's own doc comment.
 */
export function segmentPages(pages: OcrPage[]): OcrPage[][] {
  const groups: OcrPage[][] = [];
  let current: OcrPage[] = [];

  for (const page of pages) {
    const isBoundary =
      page.lines.some((line) => FIRST_PAGE.test(line)) || page.lines.includes(UNREADABLE_PAGE_MARKER);
    if (isBoundary && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(page);
  }

  if (current.length > 0) groups.push(current);
  return groups;
}
