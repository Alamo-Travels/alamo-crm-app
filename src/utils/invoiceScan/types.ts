/** One OCR'd word with its position on the page. Positions matter: this is a fixed-width
 *  report where the amount column is identified as much by x-position as by content. */
export interface OcrWord {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Tesseract's 0-100 confidence. Low values flag a field for review. */
  confidence: number;
  /** 0-based line index within the page, as grouped by Tesseract. */
  line: number;
}

export interface OcrPage {
  /** 1-based page number within the source PDF. */
  pageNumber: number;
  words: OcrWord[];
  /** One entry per line, words joined by a single space, in reading order. */
  lines: string[];
}

export interface ScannedSegment {
  /** ISO YYYY-MM-DD. This leg's own departure date. */
  date: string;
  /**
   * ISO YYYY-MM-DD. This leg's own arrival date — kept separate from `date` (its departure
   * date) even though most call sites only need one or the other. Turnaround-city detection
   * needs the true ground gap between one leg's arrival and the next leg's departure; measuring
   * departure-to-departure instead silently folds each leg's own flight time (including an
   * overnight-crossing red-eye) into the apparent layover, which can make a several-hour
   * connection look longer than a genuine multi-day stay. Do not collapse this back to a single
   * `date` field.
   */
  arrDate: string;
  /** Raw carrier text, e.g. 'QATAR AIRWAYS'. */
  carrier: string;
  /** Raw city text as printed, e.g. 'HOUSTON GEO BUSH'. */
  from: string;
  to: string;
}

export interface ScannedPassenger {
  /** LAST/FIRST MIDDLE, taken from the FOR: block with any CHD suffix stripped. */
  name: string;
  /** True when the FOR: line carried a CHD suffix. */
  child: boolean;
  amount: number | null;
  ticketNumber: string | null;
  /** Lowest word confidence that fed this row, 0-100. */
  confidence: number;
}

export type ScannedInvoiceType = 'New' | 'Voided' | 'Reissue' | 'Refund';

export interface ScannedInvoice {
  /** 1-based, inclusive, within the source PDF. */
  pageStart: number;
  pageEnd: number;
  /** Detected default. Always overridable by the operator. */
  type: ScannedInvoiceType;
  invoiceNumber: string | null;
  /** ISO YYYY-MM-DD. */
  bookingDate: string | null;
  pnr: string | null;
  passengers: ScannedPassenger[];
  segments: ScannedSegment[];
  /** Raw carrier text of the first AIR segment. */
  airlineName: string | null;
  /** Raw city text; resolved to IATA codes separately. */
  depCityText: string | null;
  arrCityText: string | null;
  depDate: string | null;
  /** Arrival back at the origin city. The default. */
  arrDateReturn: string | null;
  /** Date of the final AIR segment, whatever its destination. */
  arrDateFinal: string | null;
  netCcBilling: number | null;
  /** Human-readable reasons this invoice needs attention. Empty means Ready. */
  issues: string[];
}
