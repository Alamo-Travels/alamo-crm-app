import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

// Global test-isolation guard: several forms now autosave a draft to localStorage as the user
// types (see src/utils/formDraft.ts). Only the four *.draft.test.tsx files used to clear it
// themselves — any OTHER test that types into one of those forms for ≥500ms (its debounce window)
// writes a draft that then persists into whichever test runs next in the same file, where it can
// silently render a restore bar nobody asked for. Checked against the theme suites first
// (themeStore.test.ts / useApplyTheme.test.ts / theme-toggle.test.tsx all touch localStorage,
// some deliberately) — none of them seed it at module scope or in a beforeAll, only inline inside
// individual test bodies, which this beforeEach runs safely before every time.
beforeEach(() => {
  localStorage.clear();
});

// jsdom lacks several browser APIs that Radix UI (Select, Sheet, Tooltip)
// and the shadcn sidebar (use-mobile's matchMedia) depend on.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => undefined;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

// jsdom doesn't implement the Clipboard API; stub it so copy-to-clipboard
// buttons can call navigator.clipboard.writeText() and tests can spy on it.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.resolve() },
    writable: true,
    configurable: true,
  });
}

// jsdom doesn't implement URL.createObjectURL, used to preview a file chosen
// via an <input type="file"> before it's uploaded (e.g. organization-tab.tsx's
// logo picker) — without this, selecting a file throws synchronously inside
// the change handler and fails the test run even though assertions pass.
if (!URL.createObjectURL) {
  URL.createObjectURL = (): string => 'blob:mock-url';
}

// jsdom's Blob/File implementation doesn't implement arrayBuffer() (needed by
// the xlsx import wizard's parseXlsxFile, which reads File objects built in
// tests via `new File([...])`). Polyfill via FileReader, which jsdom does support.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
