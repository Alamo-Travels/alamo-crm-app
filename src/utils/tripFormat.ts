import { CabinClass, EnquiryFareOption, EnquiryPax, EnquiryTripSegment } from '@/api/enquiries.api';
import { formatDisplayDate } from './dateFormat';

/** Three-letter cabin codes, shown on the selected-cabin cards. A display concern only — the
 * wire format is always the full cabin name. */
export const CABIN_ABBREVIATIONS: Record<CabinClass, string> = {
  Economy: 'ECO',
  'Premium Economy': 'PRE',
  Business: 'BUS',
  First: 'FIR',
};

/** '2 Adults, 1 Child' — the traveller picker's summary. Distinct from formatPax below, which
 * renders the compact 'ADT/CHD/INF' codes used in the read-only table and detail views. */
export function summarizePax({ adults, children, infants }: EnquiryPax): string {
  const parts: string[] = [];
  if (adults > 0) parts.push(`${adults} ${adults === 1 ? 'Adult' : 'Adults'}`);
  if (children > 0) parts.push(`${children} ${children === 1 ? 'Child' : 'Children'}`);
  if (infants > 0) parts.push(`${infants} ${infants === 1 ? 'Infant' : 'Infants'}`);
  return parts.join(', ');
}

/** 'IAH → COK → IAH' — consecutive legs sharing an airport print it once. */
export function formatItinerary(segments: EnquiryTripSegment[]): string {
  const codes: string[] = [];
  for (const segment of segments) {
    if (segment.from && codes[codes.length - 1] !== segment.from) codes.push(segment.from);
    if (segment.to) codes.push(segment.to);
  }
  return codes.join(' → ');
}

/** '2 ADT, 1 CHD' — zero counts are omitted entirely. */
export function formatPax(pax: EnquiryPax): string {
  const parts: string[] = [];
  if (pax.adults > 0) parts.push(`${pax.adults} ADT`);
  if (pax.children > 0) parts.push(`${pax.children} CHD`);
  if (pax.infants > 0) parts.push(`${pax.infants} INF`);
  return parts.join(', ');
}

/** '01 Aug 2026 – 25 Aug 2026' — undated legs contribute nothing. */
export function formatSegmentDates(segments: EnquiryTripSegment[]): string {
  return segments
    .map((segment) => formatDisplayDate(segment.date))
    .filter(Boolean)
    .join(' – ');
}

/** The website's own `PayloadMapper` treats a party of 50+ as a group booking (`cruises.md` §1);
 * the staff Enquiry dialog's Cruise "Group booking" checkbox auto-ticks at the same threshold so
 * a phone-taken enquiry and a website one are judged the same way. Pure and exported so this rule
 * is unit-testable without driving the Passengers popover it reads from — that popover is nested
 * inside a modal Dialog, which jsdom cannot render (see passenger-count-field.test.tsx). */
export const GROUP_BOOKING_THRESHOLD = 50;

export function isGroupBookingSize(pax: EnquiryPax): boolean {
  return pax.adults + pax.children + pax.infants >= GROUP_BOOKING_THRESHOLD;
}

/** 'Adult USD220.00 · Child USD180.00' — only the pax types actually quoted. Shared by the
 * enquiry detail page and the send-quote preview so the two cannot drift apart. */
export function farePriceSummary(option: EnquiryFareOption): string {
  const parts = [`Adult USD${option.prices.adult.toFixed(2)}`];
  if (option.prices.child !== undefined) parts.push(`Child USD${option.prices.child.toFixed(2)}`);
  if (option.prices.infant !== undefined) parts.push(`Infant USD${option.prices.infant.toFixed(2)}`);
  return parts.join(' · ');
}
