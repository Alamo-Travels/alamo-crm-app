import { beforeEach, describe, expect, it, vi } from 'vitest';
import { disposeOcrWorker, ocrRenderedPage } from './runOcr';
import { RenderedPage } from './renderPdf';

// tesseract.js's real createWorker spins up a WASM worker thread — far too heavy for a unit
// test, and irrelevant here: this file tests ONLY the singleton/caching contract around it.
const recognize = vi.fn();
const setParameters = vi.fn();
const terminate = vi.fn();
const createWorker = vi.fn();

vi.mock('tesseract.js', () => ({
  createWorker: (...args: unknown[]) => createWorker(...args),
  PSM: { SINGLE_BLOCK: '6' },
}));

function page(pageNumber: number): RenderedPage {
  return { pageNumber, dataUrl: '', blob: new Blob() };
}

describe('OCR worker singleton', () => {
  beforeEach(async () => {
    // Reset the module's cached worker/promise between tests — `runOcr.ts` keeps that state at
    // module scope, so without this, state from one test would leak into the next.
    await disposeOcrWorker();

    createWorker.mockReset();
    setParameters.mockReset();
    recognize.mockReset();
    terminate.mockReset();
    setParameters.mockResolvedValue(undefined);
    recognize.mockResolvedValue({ data: { blocks: [] } });
    terminate.mockResolvedValue(undefined);
    createWorker.mockImplementation(async () => ({ setParameters, recognize, terminate }));
  });

  // Regression test for a shipped Important: the original `getWorker()` cached the RESOLVED
  // worker (`if (worker) return worker; worker = await createWorker('eng');`), so any second
  // call arriving before the first `await` settled also saw `null` and started its own
  // `createWorker`. Three concurrent OCR calls fired three real (heavy, leaked) workers.
  it('creates exactly one worker for concurrent OCR calls', async () => {
    await Promise.all([ocrRenderedPage(page(1)), ocrRenderedPage(page(2)), ocrRenderedPage(page(3))]);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('reuses the same worker across sequential calls', async () => {
    await ocrRenderedPage(page(1));
    await ocrRenderedPage(page(2));
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('disposeOcrWorker terminates the active worker, and a later call creates a fresh one', async () => {
    await ocrRenderedPage(page(1));
    expect(createWorker).toHaveBeenCalledTimes(1);

    await disposeOcrWorker();
    expect(terminate).toHaveBeenCalledTimes(1);

    await ocrRenderedPage(page(2));
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed initialization — a later call can still succeed', async () => {
    createWorker.mockImplementationOnce(async () => {
      throw new Error('worker init boom');
    });

    await expect(ocrRenderedPage(page(1))).rejects.toThrow('worker init boom');
    expect(createWorker).toHaveBeenCalledTimes(1);

    // The failed attempt must not be cached as if it were a usable worker — this call gets a
    // fresh attempt, which succeeds.
    await expect(ocrRenderedPage(page(2))).resolves.toEqual({ pageNumber: 2, words: [], lines: [] });
    expect(createWorker).toHaveBeenCalledTimes(2);
  });
});
