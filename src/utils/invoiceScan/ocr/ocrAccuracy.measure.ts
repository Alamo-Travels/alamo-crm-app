/**
 * NOT part of the test suite. Run explicitly:
 *   npx vitest run "src/utils/invoiceScan/ocr/ocrAccuracy.measure.ts" --testTimeout 300000
 * (Vitest's CLI has no `--include` flag as of 2.1.9 — the positional path above is a filename
 * filter, which only matches files already picked up by `test.include` in vite.config.ts. Since
 * this file's `.measure.ts` extension is deliberately excluded from the default `test.include`
 * pattern, running it requires temporarily adding `'src/**\/*.measure.ts'` to that array, running
 * the command above, then reverting vite.config.ts. See task-1-report.md, "Deviation 2".)
 *
 * Renders the reference scans, OCRs them, and reports how accurately the fields
 * that matter survive. This is the feature's go/no-go gate.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker, PSM } from 'tesseract.js';
import { describe, it } from 'vitest';

// pdfjs legacy build is the CommonJS/Node-friendly one.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Vitest runs this file as ESM, where __dirname is not defined — derive it.
const __dirname = dirname(fileURLToPath(import.meta.url));

const SCANS = resolve(__dirname, '../../../../../testDocs');

/** Every string that MUST survive OCR intact, per scan. */
const GROUND_TRUTH: Record<string, string[]> = {
  'Original.pdf': [
    '0000249', '31 JUL 26', 'MHNGLM', 'JACOB/SHIBIN THOMAS',
    'EY7545281549', '4,275.29',
  ],
  'Multi.pdf': [
    '0000243', '29 JUL 26', 'YKHRUA',
    'PAUL/PHYLIEX JAMES', 'BABU/ATHIRA', 'PAUL/MICHAELA ROSE',
    'QR7544570643/44', 'QR7544570645/46', 'QR7544570647/48',
    '1,740.99', '1,500.51', '4,982.49',
    '11 SEP 26', '25 SEP 26', '27 SEP 26', 'HOUSTON GEO BUSH', 'KOCHI',
  ],
  'Voided.pdf': [
    '0000245', '29 JUL 26', 'YFLDFO',
    'MATHEW/SIBI', 'SIBI/SHELNA',
    'QR7544871794/95', 'QR7544871796/97',
    '2,051.21', '4,102.42',
    '31 JUL 26', '16 AUG 26', '18 AUG 26', 'KOCHI',
  ],
};

/** 300 dpi equivalent — PDF user units are 1/72 inch, so scale 300/72. */
const SCALE = 300 / 72;

async function pdfToPageTexts(file: string): Promise<string[]> {
  const data = new Uint8Array(readFileSync(resolve(SCANS, file)));
  const doc = await pdfjs.getDocument({ data }).promise;

  const worker = await createWorker('eng');
  // PSM.SINGLE_BLOCK ('6') = "assume a single uniform block of text", correct for a fixed-width
  // report. tessedit_pageseg_mode is typed as the PSM enum, not a raw string.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });

  const texts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    // @ts-expect-error — @napi-rs/canvas context is structurally compatible with pdfjs's expectation.
    await page.render({ canvasContext: context, viewport }).promise;
    const png = canvas.toBuffer('image/png');
    const { data: result } = await worker.recognize(png);
    texts.push(result.text);
  }

  await worker.terminate();
  return texts;
}

/** Collapse runs of whitespace so "4 , 275 . 29" and "4,275.29" compare fairly on content. */
function squash(value: string): string {
  return value.replace(/\s+/g, ' ');
}

describe('OCR accuracy on the reference scans', () => {
  for (const [file, expected] of Object.entries(GROUND_TRUTH)) {
    it(
      `reports field-level accuracy for ${file}`,
      async () => {
        const pages = await pdfToPageTexts(file);
        const haystack = squash(pages.join('\n'));
        const found = expected.filter((value) => haystack.includes(squash(value)));
        const missing = expected.filter((value) => !haystack.includes(squash(value)));

        console.log(`\n=== ${file} ===`);
        console.log(`pages: ${pages.length}`);
        console.log(`exact hits: ${found.length}/${expected.length}`);
        if (missing.length > 0) console.log(`MISSING: ${missing.join(' | ')}`);
        console.log('--- raw OCR text ---');
        console.log(pages.join('\n--- page break ---\n'));
      },
      300_000
    );
  }
});
