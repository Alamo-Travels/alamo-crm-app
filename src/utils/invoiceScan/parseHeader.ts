import { OcrPage } from './types';

export interface ParsedHeader {
  invoiceNumber: string | null;
  bookingDate: string | null;
  pnr: string | null;
  /** True when there is no usable invoice number — a Reissue or Refund. */
  isAdjustment: boolean;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Match invoice number: at least 4 digits with a word boundary at the end.
 * Minimum 4 ensures we reject date fragments (1–2 digits: 29 from day, 26 from year) while
 * accepting real invoices (7+ digits). The word boundary `\b` prevents truncation of longer runs
 * (e.g., 8-digit number is captured whole, not as first 7 digits), and tolerates future changes
 * in invoice-number length without silent misclassification.
 * Bounded whitespace (0-3 chars) prevents the regex from skipping across an empty column to the next field.
 */
const INVOICE_NO = /ITINERARY\/INVOICE\s+NO\.?\s{0,3}([0-9]{4,}\b)/;
const DATE_LABEL = /\bDATE:\s*(\d{1,2}\s+[A-Z]{3}\s+\d{2})\b/;
/** Header line 2: the record locator sits between the customer number and `PAGE:`. */
const PNR_LINE = /CUSTOMER\s+NBR:\s*\d+\s+([A-Z0-9]{6})\b/;

/** `DD MMM YY` → ISO `YYYY-MM-DD`. A two-digit year always means 20YY. */
export function parseInvoiceDate(text: string): string | null {
  const match = /^\s*(\d{1,2})\s+([A-Z]{3})\s+(\d{2})\s*$/.exec(text.toUpperCase());
  if (!match) return null;
  const dayNum = parseInt(match[1], 10);
  if (dayNum < 1 || dayNum > 31) return null;
  const monthIndex = MONTHS.indexOf(match[2]);
  if (monthIndex < 0) return null;
  const day = match[1].padStart(2, '0');
  const month = String(monthIndex + 1).padStart(2, '0');
  return `20${match[3]}-${month}-${day}`;
}

function firstMatch(pages: OcrPage[], pattern: RegExp): string | null {
  for (const page of pages) {
    for (const line of page.lines) {
      const match = pattern.exec(line);
      if (match) return match[1];
    }
  }
  return null;
}

/**
 * Reads the three header fields shared by every invoice type.
 *
 * `isAdjustment` is deliberately TOLERANT — missing, blank, or all-zeros all mean "no invoice
 * number", because no Reissue/Refund scan has been seen and any of those is a plausible rendering.
 * The operator confirms the type from the page image regardless, so a wrong guess costs one click.
 */
export function parseHeader(pages: OcrPage[]): ParsedHeader {
  const rawNumber = firstMatch(pages, INVOICE_NO);
  const invoiceNumber = rawNumber && /[1-9]/.test(rawNumber) ? rawNumber : null;

  const rawDate = firstMatch(pages, DATE_LABEL);
  const bookingDate = rawDate ? parseInvoiceDate(rawDate) : null;

  return {
    invoiceNumber,
    bookingDate,
    pnr: firstMatch(pages, PNR_LINE),
    isAdjustment: invoiceNumber === null,
  };
}
