import { parseScannedInvoices } from '../parseInvoice';
import { UNREADABLE_PAGE_MARKER } from '../segmentPages';
import { OcrPage, ScannedInvoice } from '../types';
import { renderPdfPages } from './renderPdf';
import { ocrRenderedPage } from './runOcr';

export interface ScanProgress {
  phase: 'rendering' | 'reading';
  done: number;
  total: number;
}

export interface ScanResult {
  invoices: ScannedInvoice[];
  /** Page number → PNG data URL, for the review screen's page-1 preview. */
  pageImages: Map<number, string>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Renders every page, OCRs each in turn, then parses the whole stack into invoices.
 *
 * A page that fails to render or fails to OCR does not abort the batch — Tasks 3-6 are already
 * built around flagging bad reads via `ScannedInvoice.issues` and carrying on, because these
 * scans are routinely messy; a hard throw here would be a different, worse failure class that
 * discards every already-processed page (a real stack can run to 100+ pages). Instead, a failed
 * page contributes a synthetic `OcrPage` carrying only `UNREADABLE_PAGE_MARKER` as its line, and
 * its page number is recorded in `pageIssues`.
 *
 * The marker matters, not just the empty placeholder: `segmentPages` treats it as an invoice
 * boundary unconditionally (see that file), because there is no way to tell whether the failed
 * page WAS an invoice's `PAGE: 01` boundary — the OCR text that would prove it is exactly what's
 * missing. Without the marker, a failed boundary page silently folds itself (and every real page
 * after it up to the next detected boundary) into the PRECEDING invoice, and the invoice that
 * should have started there simply never appears — confirmed by an end-to-end probe: two single-
 * page invoices with the second page's render forced to fail produced ONE invoice under the
 * first's number, the second's number/PNR/passengers gone with no trace. Forcing a boundary
 * instead can at worst over-split a page that was really a mid-invoice continuation, which
 * produces an extra, visibly-flagged partial invoice rather than an invisible merge.
 *
 * Once `parseScannedInvoices` has grouped pages into invoices, every invoice whose page range
 * covers a failed page number gets the matching `pageIssues` message appended, so the operator
 * learns a specific page could not be read rather than the whole upload silently losing data.
 */
export async function scanPdf(
  file: File,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
  const rendered = await renderPdfPages(file, (done, total) =>
    onProgress?.({ phase: 'rendering', done, total })
  );

  const pageImages = new Map<number, string>();
  const pages: OcrPage[] = [];
  // Page number -> operator-facing reason that page's content is missing.
  const pageIssues = new Map<number, string>();

  for (const [index, page] of rendered.entries()) {
    if (page.error) {
      pageIssues.set(page.pageNumber, `Page ${page.pageNumber} could not be rendered and was skipped (${page.error}).`);
      pages.push({ pageNumber: page.pageNumber, words: [], lines: [UNREADABLE_PAGE_MARKER] });
    } else {
      pageImages.set(page.pageNumber, page.dataUrl);
      try {
        pages.push(await ocrRenderedPage(page));
      } catch (error) {
        pageIssues.set(
          page.pageNumber,
          `Page ${page.pageNumber} could not be read by OCR and was skipped (${describeError(error)}).`
        );
        pages.push({ pageNumber: page.pageNumber, words: [], lines: [UNREADABLE_PAGE_MARKER] });
      }
    }
    onProgress?.({ phase: 'reading', done: index + 1, total: rendered.length });
  }

  const invoices = parseScannedInvoices(pages);
  if (pageIssues.size > 0) {
    for (const invoice of invoices) {
      for (const [pageNumber, issue] of pageIssues) {
        if (pageNumber >= invoice.pageStart && pageNumber <= invoice.pageEnd) {
          invoice.issues.push(issue);
        }
      }
    }
  }

  return { invoices, pageImages };
}
