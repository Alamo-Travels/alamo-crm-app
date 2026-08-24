import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RenderedPage {
  /** 1-based page number within the PDF. */
  pageNumber: number;
  /** PNG data URL, shown beside the review form so the operator can read the handwriting. */
  dataUrl: string;
  blob: Blob;
  /**
   * Set when this page could not be rendered (a corrupt page, an unsupported PDF feature, etc.).
   * `dataUrl`/`blob` are empty placeholders in that case — the caller (`scanPdf`) is responsible
   * for surfacing this as an issue rather than silently proceeding as if the page were blank.
   */
  error?: string;
}

/** 300 dpi equivalent. PDF user units are 1/72 inch. */
const SCALE = 300 / 72;

/**
 * Where pdfjs-dist's WebAssembly image decoders (`jbig2.wasm`, `openjpeg.wasm`, …) are served
 * from. The files are copied out of `node_modules/pdfjs-dist/wasm` into `public/pdfjs-wasm` by a
 * plugin in `vite.config.ts`, so they always match the installed pdfjs version and are never
 * committed. `BASE_URL` rather than a bare `/` so a deployment under a sub-path still resolves.
 *
 * **This is required, not an optimisation.** pdfjs-dist 6 moved JBIG2/JPX decoding into WASM and
 * defaults `wasmUrl` to the relative string `"wasm"`, which resolves to `/wasm/` — a path this app
 * does not serve. A scan whose pages use those codecs then fails to decode, and the page renders
 * COMPLETELY BLANK rather than erroring: measured on a real 38-page agency batch, every page came
 * back with zero non-white pixels and OCR'd to zero lines, so nothing in the stack could be
 * scanned at all. It went unnoticed because the three original reference scans are DCTDecode-only
 * and never reach these decoders. Do not remove this.
 */
const WASM_URL = `${import.meta.env.BASE_URL}pdfjs-wasm/`;

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read the page image'))), 'image/png');
  });
}

/**
 * Renders every page of the PDF to a PNG at 300 dpi.
 *
 * The PDF's own embedded text layer is deliberately NOT read — measurement showed it renders
 * `0000249` as `AAAA249` and mangles dates and amounts. Every page is OCR'd fresh from the image.
 */
export async function renderPdfPages(
  file: File,
  onPage?: (pageNumber: number, total: number) => void
): Promise<RenderedPage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  // The LOADING TASK, not just its resolved document: `destroy()` lives on the task
  // (`PDFDocumentLoadingTask`), which is what owns the worker and the parsed document — the
  // `PDFDocumentProxy` itself only offers `cleanup()`, which frees cached page resources but keeps
  // the document and worker alive.
  const loadingTask = pdfjs.getDocument({ data, wasmUrl: WASM_URL });
  const doc = await loadingTask.promise;
  const pages: RenderedPage[] = [];

  try {
    await renderEachPage(doc, pages, onPage);
  } finally {
    // Nothing else ever released this — a 160-page 300-dpi batch is the size this feature was
    // built for, and the worker plus parsed document simply stayed resident afterwards. `finally`
    // rather than a trailing call: the per-page `catch` below means an ordinary bad page never
    // reaches here as a throw, but a failure in the loop's own bookkeeping still must not leak.
    // Swallowing a rejection is deliberate — failing to free memory must never turn a successful
    // render into a failed scan.
    await loadingTask.destroy().catch(() => undefined);
  }

  return pages;
}

async function renderEachPage(
  doc: pdfjs.PDFDocumentProxy,
  pages: RenderedPage[],
  onPage?: (pageNumber: number, total: number) => void
): Promise<void> {
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create a canvas to render the page');
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // The installed pdfjs-dist (^6.2.108) requires `canvas` — `canvasContext` alone (the
      // brief's original code, written against an older pdfjs-dist typing) fails to build:
      // "Property 'canvas' is missing in type ... but required in type 'RenderParameters'."
      await page.render({ canvas, canvasContext: context, viewport }).promise;

      pages.push({ pageNumber: n, dataUrl: canvas.toDataURL('image/png'), blob: await canvasToBlob(canvas) });
    } catch (error) {
      // One corrupt/unrenderable page must not discard the whole stack — a real upload can run
      // to 100+ pages, and a hard throw here would lose every page already rendered before it.
      // Record the failure against this page number and keep going; `scanPdf` turns this into
      // an operator-visible issue on whichever invoice the page belongs to, matching how every
      // other messy-scan failure mode in this pipeline is handled (flag and continue, not throw).
      pages.push({
        pageNumber: n,
        dataUrl: '',
        blob: new Blob(),
        error: error instanceof Error ? error.message : 'Could not render this page',
      });
    }
    onPage?.(n, doc.numPages);
  }
}
