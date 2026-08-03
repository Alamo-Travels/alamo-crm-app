import { vi } from 'vitest';

/**
 * Manual mock for `../renderPdf`, picked up automatically by `vi.mock('./renderPdf')`
 * (no factory) via Vitest's `__mocks__` convention.
 *
 * This exists because the REAL module cannot even be imported under jsdom: it statically
 * imports `pdfjs-dist`, whose browser build references `DOMMatrix` at module-evaluation time
 * (not lazily), and jsdom does not implement `DOMMatrix` — importing it throws
 * `ReferenceError: DOMMatrix is not defined` before any test code runs. Vitest's default
 * automocking (`vi.mock('./x')` with no factory and no manual mock) still EXECUTES the real
 * module to discover its exports, so it hits the same crash. A manual mock here is loaded
 * INSTEAD of the real module, so `renderPdf.ts` — and therefore `pdfjs-dist` — is never
 * evaluated in the test process at all.
 */
export const renderPdfPages = vi.fn();
