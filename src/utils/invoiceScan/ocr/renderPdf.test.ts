import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `renderPdf.ts` had ZERO tests (final review, I6). Its per-page `try/catch` — the fix that stops
 * one corrupt page discarding a 100+ page batch — was only ever asserted against a hand-fed
 * `{ error }` fixture in `scanPdf.errorIsolation.test.ts`, so nothing proved the PRODUCER ever
 * emits that shape. Everything from `OcrPage[]` onward is well covered; this is the half that
 * wasn't.
 *
 * `pdfjs-dist` is mocked at the MODULE boundary. That is not merely convenient: its browser build
 * touches `DOMMatrix` at module-evaluation time and jsdom has no `DOMMatrix`, so importing the real
 * package throws before any test runs — which is exactly why the `__mocks__/renderPdf.ts` manual
 * mock exists for every other test file. Mocking `pdfjs-dist` itself lets the REAL `renderPdf.ts`
 * be exercised here, which is the entire point.
 */
const getDocument = vi.fn();

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...args: unknown[]) => getDocument(...args),
}));
// A Vite `?url` import — resolvable in a real build, but there is nothing to serve here.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.min.mjs' }));

const { renderPdfPages } = await import('./renderPdf');

/** jsdom implements no 2D canvas at all, so every page would fail for the wrong reason. */
beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ fillStyle: '', fillRect: () => undefined }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value: () => 'data:image/png;base64,PAGE',
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    value: (cb: (blob: Blob) => void) => cb(new Blob(['png'])),
  });
});

interface PageStub {
  render: ReturnType<typeof vi.fn>;
}

/** Builds a fake pdf.js document. `failOn` page numbers reject at `render`, the realistic failure
 * point for a corrupt page (an unsupported operator, a broken image stream). */
function stubDocument(numPages: number, failOn: number[] = []) {
  const destroy = vi.fn().mockResolvedValue(undefined);
  const getPage = vi.fn(async (n: number): Promise<PageStub & { getViewport: () => { width: number; height: number } }> => ({
    getViewport: () => ({ width: 612, height: 792 }),
    render: vi.fn(() => ({
      promise: failOn.includes(n) ? Promise.reject(new Error(`page ${n} is corrupt`)) : Promise.resolve(undefined),
    })),
  }));
  // `destroy` sits on the LOADING TASK, not the resolved document — verified against
  // pdfjs-dist v6's `api.d.ts`, where `destroy(): Promise<void>` is declared on
  // `PDFDocumentLoadingTask` and `PDFDocumentProxy` offers only `cleanup()`. Stubbing it on the
  // document instead would make this mock disagree with the real library and quietly pass a
  // `renderPdf.ts` that leaks the worker in production.
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages, getPage }), destroy });
  return { destroy, getPage };
}

function pdfFile(): File {
  return new File(['%PDF-1.4'], 'stack.pdf', { type: 'application/pdf' });
}

beforeEach(() => {
  getDocument.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderPdfPages', () => {
  it('renders every page to a PNG data URL and blob, in page order', async () => {
    stubDocument(3);

    const pages = await renderPdfPages(pdfFile());

    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(pages.every((p) => p.dataUrl === 'data:image/png;base64,PAGE')).toBe(true);
    expect(pages.every((p) => p.blob.size > 0)).toBe(true);
    expect(pages.every((p) => p.error === undefined)).toBe(true);
  });

  it('reports progress for every page', async () => {
    stubDocument(2);
    const onPage = vi.fn();

    await renderPdfPages(pdfFile(), onPage);

    expect(onPage.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  // THE reason this file exists. A hard throw here would discard every page already rendered — a
  // real stack runs to 100+ pages, and losing all of them because page 57 is corrupt is a far worse
  // failure than losing page 57.
  it('keeps the whole batch when one page fails to render, flagging only that page', async () => {
    stubDocument(3, [2]);

    const pages = await renderPdfPages(pdfFile());

    expect(pages).toHaveLength(3);
    expect(pages[0].error).toBeUndefined();
    expect(pages[2].error).toBeUndefined();
    // The failed page keeps its NUMBER (so the page sequence stays contiguous for `segmentPages`),
    // carries the underlying reason, and has no image — the exact `{ error }` shape `scanPdf`'s
    // isolation tests hand-feed, now proven to be what this producer actually emits.
    expect(pages[1]).toMatchObject({ pageNumber: 2, dataUrl: '', error: 'page 2 is corrupt' });
  });

  it('still reports progress for a page that failed', async () => {
    stubDocument(2, [1]);
    const onPage = vi.fn();

    await renderPdfPages(pdfFile(), onPage);

    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it('does not abandon the remaining pages when the FIRST page fails', async () => {
    stubDocument(3, [1]);

    const pages = await renderPdfPages(pdfFile());

    expect(pages.map((p) => p.error !== undefined)).toEqual([true, false, false]);
  });

  // Final review, minor (browser resources are never released): the loading task owns the parsed
  // document and its worker-side transport. A 160-page 300-dpi batch is the concern.
  it('destroys the pdf.js document once every page has been rendered', async () => {
    const { destroy } = stubDocument(2);

    await renderPdfPages(pdfFile());

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the document even if rendering throws outright', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        // A failure OUTSIDE the per-page try/catch — `numPages` itself is fine but the page loop's
        // own bookkeeping throws. The document must still be released.
        getPage: () => {
          throw new Error('boom');
        },
      }),
      destroy,
    });

    // The per-page catch swallows this into an `error` page rather than rethrowing, so the call
    // resolves — what matters is that `destroy` ran either way.
    await renderPdfPages(pdfFile());

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
