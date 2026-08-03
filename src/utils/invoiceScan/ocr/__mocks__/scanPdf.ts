import { vi } from 'vitest';

/**
 * Manual mock for `../scanPdf`, picked up automatically by `vi.mock('@/utils/invoiceScan/ocr/scanPdf')`
 * (no factory) via Vitest's `__mocks__` convention — same reason as the sibling `renderPdf.ts` manual
 * mock added in Task 8.
 *
 * Vitest's default automocking (no manual mock present) still EXECUTES the real module to discover
 * its exports. The real `scanPdf.ts` statically imports `renderPdf.ts`, which statically imports
 * `pdfjs-dist`, whose browser build references `DOMMatrix` at module-evaluation time — and jsdom does
 * not implement `DOMMatrix`, so merely importing the real module throws `ReferenceError: DOMMatrix is
 * not defined` before any test code runs. A manual mock here is loaded INSTEAD of the real module, so
 * `scanPdf.ts` — and therefore `pdfjs-dist` — is never evaluated in the test process at all.
 */
export const scanPdf = vi.fn();
