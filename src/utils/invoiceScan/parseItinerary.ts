import { parseInvoiceDate } from './parseHeader';
import { OcrPage, ScannedSegment } from './types';

export interface ParsedItinerary {
  segments: ScannedSegment[];
  airlineName: string | null;
  depCityText: string | null;
  arrCityText: string | null;
  depDate: string | null;
  /** Arrival back at the origin city. The default. */
  arrDateReturn: string | null;
  /** Date of the final air segment, whatever its destination. */
  arrDateFinal: string | null;
  issues: string[];
}

/**
 * `05 NOV 26 - THURSDAY`. The separator is deliberately ANY run of non-alphanumerics, not a literal
 * hyphen: the printed dash survives OCR inconsistently and real output from testDocs carries
 * `05 NOV 26 ~- THURSDAY` and `13 SEP 26 ~— SUNDAY` alongside clean `07 NOV 26 - SATURDAY`. A
 * literal `-` silently failed to match those headings, so the leg beneath them never received a
 * date and was dropped from the itinerary entirely — on Original.pdf that lost the whole first
 * segment, and the invoice reported departing ABU DHABI ZAYED on 07 NOV instead of ATLANTA on
 * 05 NOV. The date and weekday around it are specific enough to carry the match on their own.
 */
const DATE_HEADING = /^\s*(\d{1,2}\s+[A-Z]{3}\s+\d{2})\s*[^A-Z0-9]+\s*[A-Z]+\s*$/;
/** `AIR  <CARRIER>  FLT:nnn ...` — the carrier is everything before FLT:. */
const AIR_LINE = /^\s*AIR\s+(.+?)\s+FLT:\s*\S+/;
/**
 * Case-INSENSITIVE on purpose. Real OCR of testDocs/Multi.pdf renders one departure line as
 * `Lv DOHA HAMAD INTL 740P EQP: 359` — a lowercase `v` — which a case-sensitive `LV` missed, so
 * that leg never gathered a departure city and the whole segment was discarded ("Could not fully
 * read a flight segment ... it was skipped"). It cost the outbound leg on 2 of the 3 reference
 * scans. Both patterns still anchor at the start of the line and require trailing whitespace, so
 * `ARRIVE:` (no space after `AR`) and `AIR` cannot collide with them.
 */
const LV_LINE = /^\s*LV\s+(.+?)\s{2,}\S*\s*$|^\s*LV\s+(.+?)\s*$/i;
const AR_LINE = /^\s*AR\s+(.+?)\s{2,}\S*\s*$|^\s*AR\s+(.+?)\s*$/i;

/** A leg under construction: `AR` may arrive on a later date heading than its `LV`. */
interface PartialLeg {
  carrier: string;
  from: string | null;
  fromDate: string | null;
  to: string | null;
  toDate: string | null;
}

/**
 * Everything the fixed-width layout prints AFTER the city, in the columns to its right. On a
 * clean scan the column gaps are wide runs of spaces; Tesseract collapses them to single spaces,
 * so the city cannot be isolated by whitespace and must be cut at the first of these markers.
 */
const CITY_TAIL = /\s+\d{1,4}\s*[AaPp]|\s+EQP:|\s+NON-STOP|\s+DEPART:|\s+ARRIVE:|\s+REF:|\s+\d{1,2}HR/;

function cityFrom(match: RegExpExecArray): string {
  // The old version stripped a clock time ANCHORED AT END OF STRING. That held only for fixtures
  // whose line stopped at the time; on a real scan more columns follow it, so nothing was stripped
  // and `depCityText` came out as the whole line — browser-reported as "dep/arr city not
  // recognised". Confirmed by running the real OCR over testDocs/Multi.pdf, which produced
  //   "HOUSTON GEO BUSH 615P EQP: 351"   (wanted: "HOUSTON GEO BUSH")
  //   "DOHA HAMAD INTL 450P NON-STOP"    (wanted: "DOHA HAMAD INTL")
  // and therefore handed the airport lookup a string it could never match.
  const raw = (match[1] ?? match[2] ?? '').trim();
  const cut = raw.search(CITY_TAIL);
  // The end-anchored strip is still needed AFTER the cut: OCR sometimes loses the gap entirely and
  // merges the time onto the city ("ATLANTA920P EQP: 351" → cut at EQP: → "ATLANTA920P"). Verified
  // this eats no real city text — none of ABU DHABI ZAYED, HOUSTON GEO BUSH, CHICAGO OHARE,
  // DOHA HAMAD INTL, KOCHI, ATLANTA ends in 1-4 digits followed by A/P.
  return (cut === -1 ? raw : raw.slice(0, cut)).replace(/\s*\d{1,4}[AaPp]$/, '').trim();
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/**
 * Reads the flight segments and derives the four ledger trip fields.
 *
 * Only `AIR` segments participate. Both reference scans end with a non-air
 * `OTHER DETROIT METRO / RETENTION` block; counting it would push the arrival date months out.
 */
export function parseItinerary(pages: OcrPage[]): ParsedItinerary {
  const lines = pages.flatMap((page) => page.lines);
  const segments: ScannedSegment[] = [];
  const issues: string[] = [];

  let currentDate: string | null = null;
  let leg: PartialLeg | null = null;

  const closeLeg = (): void => {
    if (!leg) return;
    if (leg.from && leg.to && leg.fromDate && leg.toDate) {
      segments.push({
        date: leg.fromDate, arrDate: leg.toDate, carrier: leg.carrier, from: leg.from, to: leg.to,
      });
    } else {
      // A leg was opened (an AIR line matched) but never gathered a complete LV+AR pair before
      // the next AIR line or end of input — e.g. a page cut off mid-itinerary, an AR line with
      // no preceding date heading, or a garbled follow-on line. Silently dropping it would let a
      // segment vanish with no trace; record it so the operator learns something is missing
      // rather than trusting an itinerary that quietly lost a leg.
      issues.push(`Could not fully read a flight segment for ${leg.carrier} — it was skipped`);
    }
    leg = null;
  };

  for (const line of lines) {
    const heading = DATE_HEADING.exec(line);
    if (heading) {
      currentDate = parseInvoiceDate(heading[1]);
      continue;
    }

    const air = AIR_LINE.exec(line);
    if (air) {
      closeLeg();
      leg = { carrier: air[1].trim(), from: null, fromDate: null, to: null, toDate: null };
      continue;
    }

    if (!leg) continue;

    // The `i` here matters as much as the one on LV_LINE itself: this guard decides whether the
    // pattern is consulted at all, so a case-sensitive gate in front of a case-insensitive pattern
    // makes the pattern's tolerance dead code. Real output carries "Lv DOHA HAMAD INTL ...".
    if (/^\s*LV\s+/i.test(line)) {
      const match = LV_LINE.exec(line);
      if (match) {
        leg.from = cityFrom(match);
        leg.fromDate = currentDate;
      }
      continue;
    }

    if (/^\s*AR\s+/i.test(line)) {
      const match = AR_LINE.exec(line);
      if (match) {
        leg.to = cityFrom(match);
        leg.toDate = currentDate;
        closeLeg();
      }
    }
  }
  closeLeg();

  if (segments.length === 0) {
    return {
      segments: [], airlineName: null, depCityText: null, arrCityText: null,
      depDate: null, arrDateReturn: null, arrDateFinal: null,
      issues: [...issues, 'No flight segments found'],
    };
  }

  const first = segments[0];
  const last = segments[segments.length - 1];

  // Turnaround: the arrival city with the longest GROUND gap before its next departure — this
  // leg's ARRIVAL date to the next leg's DEPARTURE date, never departure-to-departure. Measuring
  // departure-to-departure would fold each leg's own flight time into the apparent layover, so an
  // overnight-crossing long-haul connection (which departs one calendar day and lands the next)
  // could look longer than a genuinely short real stay. Every true connection is hours; a real
  // destination is days. Verified on both reference scans (12-19 day stays vs ~3 hour connections).
  //
  // Initialized to the last segment's arrival city: for a true one-way (a single segment) the
  // loop below never runs, and that's exactly the right answer with no ground gap to measure.
  let turnaround = last.to;
  let longestGap = -1;
  for (let i = 0; i < segments.length - 1; i++) {
    const gap = daysBetween(segments[i].arrDate, segments[i + 1].date);
    // >= (not >): on an exact tie, the LATER stay wins. Both reference scans (and this domain
    // generally) are structured as an outbound trip, one real destination, then the trip home —
    // so the stay immediately preceding the final leg home is the one most likely to be the
    // traveller's actual destination; an earlier, equally-long stay is more likely a preliminary
    // stop. Ties are expected to be rare in practice; this is a deliberate, documented choice,
    // not an arbitrary one.
    if (gap >= longestGap) {
      longestGap = gap;
      turnaround = segments[i].to;
    }
  }

  // Return-to-origin: the last segment landing back where the trip started.
  const backHome = [...segments].reverse().find((s) => s.to === first.from);

  return {
    segments,
    airlineName: first.carrier,
    depCityText: first.from,
    arrCityText: turnaround,
    depDate: first.date,
    // Both candidates are ARRIVAL dates and must read the leg's `arrDate`, never its `date` (which
    // is that leg's DEPARTURE date). They previously read `date`, which is correct only for a leg
    // that lands the same calendar day it leaves — true of every reference fixture's homebound leg,
    // which is exactly why the defect survived to the final review. A red-eye home (the ordinary
    // shape of a long-haul return) departs one day and lands the next, so reading `date` wrote an
    // arrival date one day early into the ledger. `ScannedSegment.arrDate` exists for precisely
    // this; until now only the turnaround-gap loop above consumed it.
    arrDateReturn: backHome ? backHome.arrDate : last.arrDate,
    arrDateFinal: last.arrDate,
    issues,
  };
}
