import fs from 'node:fs';
import path from 'path';
import { Plugin, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Copies pdfjs-dist's WebAssembly image decoders into `public/pdfjs-wasm` so Vite serves them in
 * dev and ships them in `dist/`.
 *
 * pdfjs-dist 6 decodes JBIG2/JPX in WASM and looks the files up at the `wasmUrl` passed to
 * `getDocument` (see `src/utils/invoiceScan/ocr/renderPdf.ts`, which points here). Copying at
 * build time rather than committing the binaries keeps them in lockstep with whatever version of
 * pdfjs-dist is installed — a committed copy would silently go stale on the next upgrade, and the
 * symptom of a mismatch is a page that renders blank rather than an error.
 *
 * Runs in `buildStart`, which fires for `vite dev` as well as `vite build`. The destination is
 * gitignored.
 */
function copyPdfjsWasm(): Plugin {
  return {
    name: 'copy-pdfjs-wasm',
    buildStart() {
      const from = path.resolve(__dirname, 'node_modules/pdfjs-dist/wasm');
      const to = path.resolve(__dirname, 'public/pdfjs-wasm');
      if (!fs.existsSync(from)) {
        this.warn(`pdfjs-dist wasm decoders not found at ${from} — scanned PDFs using JBIG2/JPX will render blank.`);
        return;
      }
      fs.rmSync(to, { recursive: true, force: true });
      fs.cpSync(from, to, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyPdfjsWasm()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
});
