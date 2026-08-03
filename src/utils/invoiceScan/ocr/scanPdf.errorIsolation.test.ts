import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanPdf } from './scanPdf';
import * as renderPdf from './renderPdf';
import * as runOcr from './runOcr';
import { OcrPage } from '../types';

vi.mock('./renderPdf');
vi.mock('./runOcr');

const HEADER = 'CUSTOMER NBR: 2812613000        MHNGLM             PAGE: 01';

function ocrPage(pageNumber: number, ...lines: string[]): OcrPage {
  return { pageNumber, lines, words: [] };
}

// Regression tests for a shipped Important: neither `renderPdfPages` nor `scanPdf`'s OCR loop
// had any error handling, so one bad page (a corrupt render, or any OCR failure) threw out of
// `scanPdf()` and discarded every already-processed page in the batch — up to 100+ pages of work
// — with no indication to the caller which page was the problem. Tasks 3-6 are built around
// flagging bad reads via `issues[]` and carrying on; a hard throw was a different failure class.
//
// A first version of this fix (fix round 1) isolated the failure but represented an unreadable
// page as an EMPTY OcrPage (`lines: []`). That was itself a shipped Critical (fix round 2): an
// empty page can never carry `segmentPages`' `PAGE: 01` marker, so if the failed page happened to
// be an INVOICE BOUNDARY, the boundary became invisible and the failed page — plus every real
// page after it up to the next detected boundary — silently folded into the PRECEDING invoice.
// One invoice's data would vanish from the output with nothing but a generic issue attached to
// the WRONG invoice to show for it. The tests below assert the two invoices involved always stay
// SEPARATE, not merely that `scanPdf` doesn't throw.
describe('scanPdf per-page error isolation', () => {
  beforeEach(() => {
    vi.mocked(renderPdf.renderPdfPages).mockReset();
    vi.mocked(runOcr.ocrRenderedPage).mockReset();
  });

  it('keeps two single-page invoices separate when the second page fails to render', async () => {
    vi.mocked(renderPdf.renderPdfPages).mockResolvedValue([
      { pageNumber: 1, dataUrl: 'data:image/png;base64,PAGE1', blob: new Blob() },
      { pageNumber: 2, dataUrl: '', blob: new Blob(), error: 'canvas exploded' },
    ]);
    vi.mocked(runOcr.ocrRenderedPage).mockResolvedValue(
      ocrPage(1, 'ITINERARY/INVOICE NO. 0000111   DATE: 31 JUL 26', HEADER, 'FOR: A/B')
    );

    const result = await scanPdf(new File([], 'stack.pdf'));

    // The failed page is never handed to OCR — there's nothing to read.
    expect(runOcr.ocrRenderedPage).toHaveBeenCalledTimes(1);

    // TWO invoices, not one: invoice A (page 1) must not have absorbed page 2.
    expect(result.invoices).toHaveLength(2);
    expect(result.invoices[0].invoiceNumber).toBe('0000111');
    expect(result.invoices[0].pageStart).toBe(1);
    expect(result.invoices[0].pageEnd).toBe(1);

    // Whatever invoice B was is a separate, visibly-flagged entry — not silently missing.
    expect(result.invoices[1].pageStart).toBe(2);
    expect(result.invoices[1].pageEnd).toBe(2);
    expect(
      result.invoices[1].issues.some((issue) => issue.includes('Page 2') && /render/i.test(issue))
    ).toBe(true);

    // No image for a page that never rendered; the good page's image is still there.
    expect(result.pageImages.has(2)).toBe(false);
    expect(result.pageImages.get(1)).toBe('data:image/png;base64,PAGE1');
  });

  it('isolates a page that fails OCR into its own flagged entry, without losing the earlier invoice', async () => {
    vi.mocked(renderPdf.renderPdfPages).mockResolvedValue([
      { pageNumber: 1, dataUrl: 'data:image/png;base64,PAGE1', blob: new Blob() },
      { pageNumber: 2, dataUrl: 'data:image/png;base64,PAGE2', blob: new Blob() },
    ]);
    vi.mocked(runOcr.ocrRenderedPage).mockImplementation(async (page) => {
      if (page.pageNumber === 1) {
        return ocrPage(1, 'ITINERARY/INVOICE NO. 0000111   DATE: 31 JUL 26', HEADER, 'FOR: A/B');
      }
      throw new Error('tesseract crashed');
    });

    const result = await scanPdf(new File([], 'stack.pdf'));

    expect(result.invoices).toHaveLength(2);
    expect(result.invoices[0].invoiceNumber).toBe('0000111');
    expect(result.invoices[0].pageStart).toBe(1);
    expect(result.invoices[0].pageEnd).toBe(1);

    expect(result.invoices[1].pageStart).toBe(2);
    expect(result.invoices[1].pageEnd).toBe(2);
    expect(
      result.invoices[1].issues.some((issue) => issue.includes('Page 2') && /ocr/i.test(issue))
    ).toBe(true);

    // Rendering succeeded for page 2 even though OCR on it failed, so its image is still shown —
    // the operator can still look at the handwriting even where the machine reading failed.
    expect(result.pageImages.get(2)).toBe('data:image/png;base64,PAGE2');
  });

  it("keeps two multi-page invoices separate when the second invoice's boundary page fails to render", async () => {
    vi.mocked(renderPdf.renderPdfPages).mockResolvedValue([
      { pageNumber: 1, dataUrl: 'data:image/png;base64,PAGE1', blob: new Blob() },
      { pageNumber: 2, dataUrl: 'data:image/png;base64,PAGE2', blob: new Blob() },
      { pageNumber: 3, dataUrl: '', blob: new Blob(), error: 'canvas exploded' },
      { pageNumber: 4, dataUrl: 'data:image/png;base64,PAGE4', blob: new Blob() },
    ]);
    vi.mocked(runOcr.ocrRenderedPage).mockImplementation(async (page) => {
      if (page.pageNumber === 1) {
        return ocrPage(1, 'ITINERARY/INVOICE NO. 0000111   DATE: 31 JUL 26', HEADER, 'FOR: A/B');
      }
      if (page.pageNumber === 2) {
        return ocrPage(2, 'NET CC BILLING     10.00*');
      }
      // Page 3 (invoice B's PAGE: 01 boundary) fails to render — handled below, never OCR'd.
      // Page 4 is invoice B's continuation: its real content, with no boundary marker of its
      // own, is all that's left of invoice B once page 3 is gone.
      return ocrPage(4, 'FOR: C/D');
    });

    const result = await scanPdf(new File([], 'stack.pdf'));

    // Invoice A is intact and did NOT absorb pages 3-4.
    expect(result.invoices).toHaveLength(2);
    expect(result.invoices[0].invoiceNumber).toBe('0000111');
    expect(result.invoices[0].pageStart).toBe(1);
    expect(result.invoices[0].pageEnd).toBe(2);

    // Invoice B surfaces as its own entry covering pages 3-4, flagged for the missing boundary
    // page, but with page 4's real passenger data (`FOR: C/D`) intact and visible — not silently
    // absorbed into invoice A with no trace.
    expect(result.invoices[1].pageStart).toBe(3);
    expect(result.invoices[1].pageEnd).toBe(4);
    expect(result.invoices[1].passengers.some((p) => p.name === 'C/D')).toBe(true);
    expect(
      result.invoices[1].issues.some((issue) => issue.includes('Page 3') && /render/i.test(issue))
    ).toBe(true);
  });
});
