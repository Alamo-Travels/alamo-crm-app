import { createWorker, PSM, Worker } from 'tesseract.js';
import { OcrPage, OcrWord } from '../types';
import { RenderedPage } from './renderPdf';

// Cache the in-flight INITIALIZATION PROMISE, not the resolved worker. `getWorker` has no
// `await` of its own before caching, so it runs to completion (including the assignment below)
// synchronously before any concurrent caller gets a turn — every caller that arrives while
// initialization is still pending shares this one promise instead of starting its own
// `createWorker`. Caching the resolved value instead (the original bug) left a window between
// "initialization started" and "the module variable is assigned" during which every concurrent
// caller saw nothing cached and started its own `createWorker`, leaking WASM instances and
// worker threads that `disposeOcrWorker` could never reach (it only ever sees whichever
// assignment landed last).
let workerPromise: Promise<Worker> | null = null;

async function initWorker(): Promise<Worker> {
  const created = await createWorker('eng');
  // PSM 6 — "a single uniform block of text". Correct for a fixed-width Sabre report;
  // the default auto mode fragments the columns. tessedit_pageseg_mode is typed as the PSM
  // enum, not a raw string — passing '6' is a TypeScript error (string enums don't accept a
  // bare string literal), so PSM.SINGLE_BLOCK is used instead of the string form.
  await created.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  return created;
}

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = initWorker().catch((error: unknown) => {
      // A failed initialization must not be cached as if it were a usable worker — every
      // future call would then replay the same failure forever. Clear the slot so the next
      // call gets a fresh attempt, then re-throw so THIS call still surfaces the failure.
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** Frees the WASM worker. Call when the scan screen unmounts. */
export async function disposeOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  const active = await pending.catch(() => null);
  if (active) await active.terminate();
}

/**
 * OCRs one rendered page into words with positions and confidence.
 *
 * Word boxes matter: this is a fixed-width report where column position carries meaning, and
 * per-word confidence is what flags a field for review rather than presenting it as certain.
 */
export async function ocrRenderedPage(page: RenderedPage): Promise<OcrPage> {
  const active = await getWorker();
  const { data } = await active.recognize(page.blob, {}, { blocks: true });

  const words: OcrWord[] = [];
  const lines: string[] = [];

  let lineIndex = 0;
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines.push(line.text.replace(/\n+$/, ''));
        for (const word of line.words ?? []) {
          words.push({
            text: word.text,
            left: word.bbox.x0,
            top: word.bbox.y0,
            right: word.bbox.x1,
            bottom: word.bbox.y1,
            confidence: word.confidence,
            line: lineIndex,
          });
        }
        lineIndex++;
      }
    }
  }

  return { pageNumber: page.pageNumber, words, lines };
}
