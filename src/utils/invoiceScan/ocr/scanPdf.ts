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
 * Renders every page, OCRs each in turn, then parses the stack into invoices.
 *
 * A page that fails to render or OCR does not abort the batch — these scans are routinely messy
 * and a throw would discard every page already processed. The failed page contributes a synthetic
 * `OcrPage` carrying only `UNREADABLE_PAGE_MARKER`, and its number is recorded in `pageIssues`.
 *
 * The marker matters, not just the placeholder: `segmentPages` treats it as an invoice boundary
 * unconditionally, because the OCR text that would prove whether it was one is exactly what is
 * missing. Without it a failed boundary page folds itself and everything after it into the
 * PRECEDING invoice, and the invoice starting there never appears — probe-confirmed. Over-
 * splitting instead produces a visibly flagged partial invoice rather than an invisible merge.
 *
 * Afterwards every invoice whose page range covers a failed page gets the matching issue appended.
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
