import { parseHeader } from './parseHeader';
import { parseItinerary } from './parseItinerary';
import { parsePassengers } from './parsePassengers';
import { segmentPages } from './segmentPages';
import { OcrPage, ScannedInvoice } from './types';

/** Words below this Tesseract confidence make their invoice need a look. */
const LOW_CONFIDENCE = 70;

function parseOne(pages: OcrPage[]): ScannedInvoice {
  const header = parseHeader(pages);
  const { passengers, netCcBilling, issues: passengerIssues } = parsePassengers(pages);
  const itinerary = parseItinerary(pages);

  const issues = [...passengerIssues, ...itinerary.issues];

  if (!header.bookingDate) issues.push('No booking date found');
  if (!header.pnr) issues.push('No PNR found');

  if (header.isAdjustment) {
    issues.push('Confirm Reissue or Refund and enter the amount from the handwriting');
  }

  // Deliberately no `confidence > 0` floor: a word scored exactly 0 is an entirely ordinary
  // Tesseract score for a badly garbled character — the MOST suspect class of read, not the
  // least. There is no "empty token" case to filter out here: Tesseract emits no word at all
  // where it found no text (see ocr/scanPdf.ts), so every entry in `page.words` is a real word
  // with a real confidence. Do not reinstate a `> 0` guard.
  const lowConfidence = pages
    .flatMap((page) => page.words)
    .some((word) => word.confidence < LOW_CONFIDENCE);
  if (lowConfidence) issues.push('Some text was read with low confidence — check every field');

  return {
    pageStart: pages[0].pageNumber,
    pageEnd: pages[pages.length - 1].pageNumber,
    // Reissue is the safer default of the two adjustment kinds: it keeps the invoice in the
    // ledger as a positive line, and the operator confirms from the handwriting regardless.
    type: header.isAdjustment ? 'Reissue' : 'New',
    invoiceNumber: header.invoiceNumber,
    bookingDate: header.bookingDate,
    pnr: header.pnr,
    passengers,
    segments: itinerary.segments,
    airlineName: itinerary.airlineName,
    depCityText: itinerary.depCityText,
    arrCityText: itinerary.arrCityText,
    depDate: itinerary.depDate,
    arrDateReturn: itinerary.arrDateReturn,
    arrDateFinal: itinerary.arrDateFinal,
    netCcBilling,
    issues,
  };
}

/** Turns a whole OCR'd stack into one reviewable record per invoice. */
export function parseScannedInvoices(pages: OcrPage[]): ScannedInvoice[] {
  return segmentPages(pages).map(parseOne);
}
