import { describe, expect, it } from 'vitest';
import { parseItinerary } from './parseItinerary';
import { OcrPage } from './types';

function pageOf(pageNumber: number, ...lines: string[]): OcrPage {
  return { pageNumber, lines, words: [] };
}

/** Original.pdf — ATL → AUH → COK, back 26 Nov, plus a trailing non-air RETENTION block. */
const ORIGINAL = [
  pageOf(1,
    '05 NOV 26  -  THURSDAY',
    '   AIR   ETIHAD AIRWAYS          FLT:14      BUSINESS',
    '         LV ATLANTA                          920P',
    '06 NOV 26  -  FRIDAY',
    '         AR ABU DHABI ZAYED                  730P',
    '07 NOV 26  -  SATURDAY',
    '   AIR   ETIHAD AIRWAYS          FLT:330     BUSINESS',
    '         LV ABU DHABI ZAYED                  230A',
    '         AR KOCHI                            755A',
    '26 NOV 26  -  THURSDAY',
    '   AIR   ETIHAD AIRWAYS          FLT:1019    ECONOMY',
    '         LV KOCHI                            420A',
    '         AR ABU DHABI ZAYED                  645A',
    '   AIR   ETIHAD AIRWAYS          FLT:13      BUSINESS',
    '         LV ABU DHABI ZAYED                  920A',
    '         AR ATLANTA                          350P',
    '25 MAY 27  -  TUESDAY',
    '   OTHER DETROIT METRO',
    '         RETENTION'),
];

/** Multi.pdf — HOU → DOH → COK, back to HOU 25 Sep, then a domestic HOU → ORD on 27 Sep. */
const MULTI = [
  pageOf(1,
    '11 SEP 26  -  FRIDAY',
    '   AIR   QATAR AIRWAYS   FLT:714   ECONOMY',
    '         LV HOUSTON GEO BUSH       615P',
    '12 SEP 26  -  SATURDAY',
    '         AR DOHA HAMAD INTL        450P',
    '   AIR   QATAR AIRWAYS   FLT:516   ECONOMY',
    '         LV DOHA HAMAD INTL        740P',
    '13 SEP 26  -  SUNDAY',
    '         AR KOCHI                  245A',
    '25 SEP 26  -  FRIDAY',
    '   AIR   QATAR AIRWAYS   FLT:517   ECONOMY',
    '         LV KOCHI                  415A',
    '         AR DOHA HAMAD INTL        605A',
    '   AIR   QATAR AIRWAYS   FLT:713   ECONOMY',
    '         LV DOHA HAMAD INTL        800A',
    '         AR HOUSTON GEO BUSH       355P',
    '27 SEP 26  -  SUNDAY',
    '   AIR   AMERICAN AIRLINES  FLT:3322  ECONOMY',
    '         LV HOUSTON GEO BUSH       208P',
    '         AR CHICAGO OHARE          508P'),
];

describe('parseItinerary', () => {
  it('ignores non-air segments so RETENTION does not become the arrival date', () => {
    const result = parseItinerary(ORIGINAL);
    expect(result.segments.every((s) => s.to !== 'DETROIT METRO')).toBe(true);
    expect(result.arrDateFinal).toBe('2026-11-26');
  });

  it('takes the origin and departure date from the first air segment', () => {
    const result = parseItinerary(ORIGINAL);
    expect(result.depCityText).toBe('ATLANTA');
    expect(result.depDate).toBe('2026-11-05');
  });

  it('picks the turnaround city by longest ground gap, skipping connections', () => {
    expect(parseItinerary(ORIGINAL).arrCityText).toBe('KOCHI');
    expect(parseItinerary(MULTI).arrCityText).toBe('KOCHI');
  });

  it('reads the carrier from the first air segment', () => {
    expect(parseItinerary(ORIGINAL).airlineName).toBe('ETIHAD AIRWAYS');
    expect(parseItinerary(MULTI).airlineName).toBe('QATAR AIRWAYS');
  });

  it('offers both candidate arrival dates when a trailing domestic leg follows the return', () => {
    const result = parseItinerary(MULTI);
    expect(result.arrDateReturn).toBe('2026-09-25');
    expect(result.arrDateFinal).toBe('2026-09-27');
  });

  it('gives identical candidates for a plain round trip', () => {
    const result = parseItinerary(ORIGINAL);
    expect(result.arrDateReturn).toBe('2026-11-26');
    expect(result.arrDateFinal).toBe('2026-11-26');
  });

  it('falls back to the final arrival for a one-way with no turnaround gap', () => {
    const oneWay = [
      pageOf(1,
        '05 NOV 26  -  THURSDAY',
        '   AIR   ETIHAD AIRWAYS   FLT:14   BUSINESS',
        '         LV ATLANTA               920P',
        '         AR ABU DHABI ZAYED       730P'),
    ];
    const result = parseItinerary(oneWay);
    expect(result.depCityText).toBe('ATLANTA');
    expect(result.arrCityText).toBe('ABU DHABI ZAYED');
    expect(result.arrDateReturn).toBe('2026-11-05');
  });

  it('flags an invoice with no air segments', () => {
    expect(parseItinerary([pageOf(1, 'FOR: A/B')]).issues).toContain('No flight segments found');
  });

  // --- Regression tests ------------------------------------------------------------------

  it('strips a clock time merged directly onto the city with no OCR gap', () => {
    const merged = [
      pageOf(1,
        '05 NOV 26  -  THURSDAY',
        '   AIR   ETIHAD AIRWAYS   FLT:14   BUSINESS',
        '         LV ATLANTA920P',
        '         AR ABU DHABI ZAYED730P',
        '06 NOV 26  -  FRIDAY',
        '   AIR   ETIHAD AIRWAYS   FLT:15   BUSINESS',
        '         LV ABU DHABI ZAYED900A',
        '         AR ATLANTA300P'),
    ];
    const result = parseItinerary(merged);
    expect(result.depCityText).toBe('ATLANTA');
    expect(result.arrCityText).toBe('ABU DHABI ZAYED');
    expect(result.arrDateReturn).toBe('2026-11-06');
  });

  it('measures ground time (arrival-to-next-departure), not calendar-day-to-calendar-day, so an overnight connection does not outrank a short real stay', () => {
    const nearTie = [
      pageOf(1,
        '01 JAN 26  -  THURSDAY',
        '   AIR   TEST AIRWAYS   FLT:100   ECONOMY',
        '         LV ORIGIN CITY            1130P',
        '02 JAN 26  -  FRIDAY',
        '         AR CONNECT CITY           600A',
        '   AIR   TEST AIRWAYS   FLT:200   ECONOMY',
        '         LV CONNECT CITY           800A',
        '         AR REAL CITY              200P',
        '03 JAN 26  -  SATURDAY',
        '   AIR   TEST AIRWAYS   FLT:300   ECONOMY',
        '         LV REAL CITY              900A',
        '         AR ORIGIN CITY            300P'),
    ];
    const result = parseItinerary(nearTie);
    expect(result.arrCityText).toBe('REAL CITY');
  });

  it('does not collapse the only intermediate city to the origin on a same-day round trip', () => {
    const sameDay = [
      pageOf(1,
        '10 JUN 26  -  WEDNESDAY',
        '   AIR   TEST AIRWAYS   FLT:100   ECONOMY',
        '         LV DALLAS                600A',
        '         AR HOUSTON               700A',
        '   AIR   TEST AIRWAYS   FLT:200   ECONOMY',
        '         LV HOUSTON               900A',
        '         AR DALLAS                1000A'),
    ];
    const result = parseItinerary(sameDay);
    expect(result.arrCityText).toBe('HOUSTON');
  });

  // --- Final review, I3 -------------------------------------------------------------------
  //
  // `arrDateReturn`/`arrDateFinal` are ARRIVAL dates by definition (the spec: "arrival date of the
  // last segment whose AR city equals depCity"), and `ScannedSegment.arrDate` was added later
  // for exactly this — but only the turnaround-gap loop ever consumed it; both candidates were
  // taken from the leg's DEPARTURE date. Invisible against every existing fixture because their
  // homebound legs all land the same calendar day they leave, so `.date === .arrDate`. A red-eye
  // home — the ordinary shape of a long-haul return — therefore wrote an arrival date one day
  // early into the ledger.
  it('uses the return leg\'s ARRIVAL date, not its departure date, when the homebound leg crosses midnight', () => {
    const overnightReturn = [
      pageOf(1,
        '05 NOV 26  -  THURSDAY',
        '   AIR   ETIHAD AIRWAYS   FLT:14   BUSINESS',
        '         LV ATLANTA               920P',
        '06 NOV 26  -  FRIDAY',
        '         AR KOCHI                 730P',
        '26 NOV 26  -  THURSDAY',
        '   AIR   ETIHAD AIRWAYS   FLT:13   BUSINESS',
        '         LV KOCHI                 1130P',
        '27 NOV 26  -  FRIDAY',
        '         AR ATLANTA               600A'),
    ];
    const result = parseItinerary(overnightReturn);
    // The traveller is back in Atlanta on the 27th; the 26th is only when they left Kochi.
    expect(result.arrDateReturn).toBe('2026-11-27');
    expect(result.arrDateFinal).toBe('2026-11-27');
  });

  it('uses the final leg\'s ARRIVAL date for the final-leg candidate when it differs from the return leg', () => {
    const overnightDomesticTail = [
      pageOf(1,
        '11 SEP 26  -  FRIDAY',
        '   AIR   QATAR AIRWAYS   FLT:714   ECONOMY',
        '         LV HOUSTON               615P',
        '         AR KOCHI                 900P',
        '25 SEP 26  -  FRIDAY',
        '   AIR   QATAR AIRWAYS   FLT:713   ECONOMY',
        '         LV KOCHI                 800A',
        '         AR HOUSTON               355P',
        '27 SEP 26  -  SUNDAY',
        '   AIR   AMERICAN AIRLINES   FLT:3322   ECONOMY',
        '         LV HOUSTON               1130P',
        '28 SEP 26  -  MONDAY',
        '         AR CHICAGO               130A'),
    ];
    const result = parseItinerary(overnightDomesticTail);
    expect(result.arrDateReturn).toBe('2026-09-25'); // landed back at the origin, same day
    expect(result.arrDateFinal).toBe('2026-09-28'); // the tail leg lands after midnight
  });

  it('flags a leg that never completes instead of silently dropping it', () => {
    const partial = [
      pageOf(1,
        '05 NOV 26  -  THURSDAY',
        '   AIR   ETIHAD AIRWAYS   FLT:14   BUSINESS',
        '         LV ATLANTA               920P',
        '         AR ABU DHABI ZAYED       730P',
        '   AIR   DELTA AIR LINES   FLT:99   BUSINESS',
        '         LV ABU DHABI ZAYED       230A'),
    ];
    const result = parseItinerary(partial);
    expect(result.segments).toHaveLength(1);
    expect(result.issues.some((issue) => issue.includes('DELTA AIR LINES'))).toBe(true);
  });
});

/**
 * Browser-reported: "dep city / arr city not mapped or recognised". `cityFrom` stripped the clock
 * time ANCHORED AT END OF STRING, which holds only when the line stops at the time — as every
 * fixture in this file did. On a real scan the fixed-width columns to the right survive OCR as
 * ordinary single-spaced text, so nothing was stripped and the whole line became the city, e.g.
 * "HOUSTON GEO BUSH 615P EQP: 351". The airport lookup could never match that. Lines below are
 * copied verbatim from the real OCR of testDocs/Multi.pdf and testDocs/Original.pdf.
 */
describe('city extraction against real OCR output (trailing columns present)', () => {
  it('cuts the trailing time and equipment columns off the departure city', () => {
    const result = parseItinerary([
      pageOf(
        1,
        '11 SEP 26 - FRIDAY',
        'AIR QATAR AIRWAYS FLT:714 ECONOMY MEALS',
        'LV HOUSTON GEO BUSH 615P EQP: 351',
        '12 SEP 26 - SATURDAY',
        'AR DOHA HAMAD INTL 450P NON-STOP'
      ),
    ]);

    expect(result.segments[0].from).toBe('HOUSTON GEO BUSH');
    expect(result.segments[0].to).toBe('DOHA HAMAD INTL');
  });

  it('handles a time OCR merged onto the city with no surviving gap', () => {
    // Real output from Original.pdf: "LV ATLANTA 920pP EQP: 351" — note the doubled/misread
    // meridiem. Cutting at ` EQP:` leaves "ATLANTA 920pP", so the end-anchored strip still has to
    // run afterwards.
    const result = parseItinerary([
      pageOf(
        1,
        '05 NOV 26 - THURSDAY',
        'AIR ETIHAD AIRWAYS FLT:14 BUSINESS MEALS',
        'LV ATLANTA 920pP EQP: 351',
        '06 NOV 26 - FRIDAY',
        'AR ABU DHABI ZAYED 730P NON-STOP'
      ),
    ]);

    expect(result.segments[0].from).toBe('ATLANTA');
    expect(result.segments[0].to).toBe('ABU DHABI ZAYED');
  });
});

/**
 * Two OCR-tolerance regressions, both copied verbatim from real output over testDocs/. Each cost a
 * whole flight segment before it was fixed, and neither was reachable from an idealised fixture.
 */
describe('OCR-damaged itinerary text', () => {
  it('reads a date heading whose dash OCRs as something other than a hyphen', () => {
    // "05 NOV 26 ~- THURSDAY" and "13 SEP 26 ~— SUNDAY" both occur in real output. A literal `-`
    // missed them, so the leg beneath got no date and was dropped — on Original.pdf that lost the
    // entire first segment and reported the trip as departing ABU DHABI ZAYED, not ATLANTA.
    const result = parseItinerary([
      pageOf(
        1,
        '05 NOV 26 ~- THURSDAY',
        'AIR ETIHAD AIRWAYS FLT:14 BUSINESS MEALS',
        'LV ATLANTA 920P EQP: 351',
        '06 NOV 26 ~- FRIDAY',
        'AR ABU DHABI ZAYED 730P NON-STOP'
      ),
    ]);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].from).toBe('ATLANTA');
    expect(result.segments[0].date).toBe('2026-11-05');
    expect(result.segments[0].arrDate).toBe('2026-11-06');
  });

  it('reads a departure line whose LV OCRs in mixed case', () => {
    // Real output renders one leg as "Lv DOHA HAMAD INTL 740P EQP: 359". A case-sensitive `LV`
    // left the leg with no departure city, so it was discarded as unreadable.
    const result = parseItinerary([
      pageOf(
        1,
        '12 SEP 26 - SATURDAY',
        'AIR QATAR AIRWAYS FLT:516 ECONOMY MEALS',
        'Lv DOHA HAMAD INTL 740P EQP: 359',
        '13 SEP 26 - SUNDAY',
        'AR KOCHI 245A NON-STOP'
      ),
    ]);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].from).toBe('DOHA HAMAD INTL');
    expect(result.segments[0].to).toBe('KOCHI');
  });
});
