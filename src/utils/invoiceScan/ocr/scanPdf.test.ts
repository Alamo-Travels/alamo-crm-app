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

describe('scanPdf', () => {
  beforeEach(() => {
    vi.mocked(renderPdf.renderPdfPages).mockReset();
    vi.mocked(runOcr.ocrRenderedPage).mockReset();
  });

  it('renders, OCRs and parses into invoices', async () => {
    vi.mocked(renderPdf.renderPdfPages).mockResolvedValue([
      { pageNumber: 1, dataUrl: 'data:image/png;base64,AAA', blob: new Blob() },
    ]);
    vi.mocked(runOcr.ocrRenderedPage).mockResolvedValue(
      ocrPage(1, 'ITINERARY/INVOICE NO. 0000249   DATE: 31 JUL 26', HEADER, 'FOR: A/B')
    );

    const result = await scanPdf(new File([], 'stack.pdf'));

    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].invoiceNumber).toBe('0000249');
  });

  it('keeps each page image so the review screen can show the handwriting', async () => {
    vi.mocked(renderPdf.renderPdfPages).mockResolvedValue([
      { pageNumber: 1, dataUrl: 'data:image/png;base64,PAGE1', blob: new Blob() },
    ]);
    vi.mocked(runOcr.ocrRenderedPage).mockResolvedValue(ocrPage(1, HEADER, 'FOR: A/B'));

    const result = await scanPdf(new File([], 'stack.pdf'));
    expect(result.pageImages.get(1)).toBe('data:image/png;base64,PAGE1');
  });

  it('reports progress as each page is OCR\'d', async () => {
    vi.mocked(renderPdf.renderPdfPages).mockResolvedValue([
      { pageNumber: 1, dataUrl: 'a', blob: new Blob() },
      { pageNumber: 2, dataUrl: 'b', blob: new Blob() },
    ]);
    vi.mocked(runOcr.ocrRenderedPage).mockResolvedValue(ocrPage(1, HEADER));

    const onProgress = vi.fn();
    await scanPdf(new File([], 'stack.pdf'), onProgress);

    expect(onProgress).toHaveBeenCalledWith({ phase: 'reading', done: 1, total: 2 });
    expect(onProgress).toHaveBeenCalledWith({ phase: 'reading', done: 2, total: 2 });
  });
});
