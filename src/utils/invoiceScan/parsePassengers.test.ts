import { describe, expect, it } from 'vitest';
import { parsePassengers } from './parsePassengers';
import { OcrPage } from './types';

function pageOf(pageNumber: number, ...lines: string[]): OcrPage {
  return { pageNumber, lines, words: [] };
}

/** Original.pdf — one passenger, singular AIR TICKET label. */
const SINGLE = [
  pageOf(1,
    'FOR: JACOB/SHIBIN THOMAS',
    '',
    'AIR TICKET   EY7545281549       JACOB SHIBIN THOMAS',
    'ELEC TKT                        BILLED TO VIXXXXXXXXXXXX3780      4,275.29*'),
  pageOf(2,
    'SUB TOTAL          4,275.29',
    'LESS DISCOUNT        223.00-',
    'NET CC BILLING     4,275.29*'),
];

/** Multi.pdf — three passengers, continuation lines, CHD, plural label, coupon ranges. */
const MULTI = [
  pageOf(1,
    'FOR: PAUL/PHYLIEX JAMES',
    '     BABU/ATHIRA',
    '     PAUL/MICHAELA ROSE CHD',
    '',
    '11 SEP 26  -  FRIDAY'),
  pageOf(2,
    'AIR TICKETS   QR7544570643/44   PAUL PHYLIEX JAMES',
    'ELEC TKT                        BILLED TO VIXXXXXXXXXXXXX5035    1,740.99*',
    'AIR TICKETS   QR7544570645/46   BABU ATHIRA',
    'ELEC TKT                        BILLED TO VIXXXXXXXXXXXXX5035    1,740.99*',
    'AIR TICKETS   QR7544570647/48   PAUL MICHAELA ROSE C',
    'ELEC TKT                        BILLED TO VIXXXXXXXXXXXXX5035    1,500.51*',
    'SUB TOTAL                       4,982.49',
    'LESS DISCOUNT                     440.22-',
    'NET CC BILLING                  4,982.49*'),
];

describe('parsePassengers', () => {
  it('reads a single passenger and its amount', () => {
    const result = parsePassengers(SINGLE);
    expect(result.passengers).toEqual([
      { name: 'Jacob/Shibin Thomas', child: false, amount: 4275.29, ticketNumber: 'EY7545281549', confidence: 100 },
    ]);
    expect(result.netCcBilling).toBe(4275.29);
    expect(result.issues).toEqual([]);
  });

  it('reads FOR: continuation lines as further passengers', () => {
    expect(parsePassengers(MULTI).passengers.map((p) => p.name)).toEqual([
      'Paul/Phyliex James',
      'Babu/Athira',
      'Paul/Michaela Rose',
    ]);
  });

  // A Sabre invoice prints every PAX name in caps, and OCR reads it back that way. Storing that
  // verbatim put SHOUTING names in the ledger beside the Title Case ones every other entry route
  // produces (the bulk .xlsx importer title-cases via the API's own normalizeName; the interactive
  // booking form builds the name from an already-normalized Customer record). Normalizing here —
  // the one place a scanned name becomes data — makes the review screen, the customer match and
  // the saved booking all agree.
  it('title-cases the scanned name, which OCR reads back in all caps', () => {
    expect(parsePassengers(SINGLE).passengers[0].name).toBe('Jacob/Shibin Thomas');
  });

  it('strips the CHD suffix but records that the passenger is a child', () => {
    const third = parsePassengers(MULTI).passengers[2];
    expect(third.name).toBe('Paul/Michaela Rose');
    expect(third.child).toBe(true);
  });

  it('pairs each passenger with its own amount in order', () => {
    expect(parsePassengers(MULTI).passengers.map((p) => p.amount)).toEqual([1740.99, 1740.99, 1500.51]);
  });

  it('reads coupon-range ticket numbers', () => {
    expect(parsePassengers(MULTI).passengers.map((p) => p.ticketNumber)).toEqual([
      'QR7544570643/44',
      'QR7544570645/46',
      'QR7544570647/48',
    ]);
  });

  it('reconciles the passenger amounts against NET CC BILLING', () => {
    const result = parsePassengers(MULTI);
    expect(result.netCcBilling).toBe(4982.49);
    expect(result.issues).toEqual([]);
  });

  it('flags an invoice whose amounts do not sum to NET CC BILLING', () => {
    const broken = [
      pageOf(1, 'FOR: A/B', '', 'AIR TICKET  X1  A B', 'ELEC TKT  BILLED TO VI1111   10.00*'),
      pageOf(2, 'NET CC BILLING   99.00*'),
    ];
    expect(parsePassengers(broken).issues).toContain(
      'Passenger amounts total 10.00 but NET CC BILLING is 99.00'
    );
  });

  it('flags a mismatch between FOR: names and ticket blocks', () => {
    const broken = [
      pageOf(1, 'FOR: A/B', '     C/D', '', 'AIR TICKET  X1  A B', 'ELEC TKT  BILLED TO VI1   10.00*'),
    ];
    expect(parsePassengers(broken).issues).toContain('Found 2 passenger names but 1 ticket block');
  });

  it('flags an invoice with no FOR: block at all', () => {
    expect(parsePassengers([pageOf(1, 'nothing useful')]).issues).toContain('No passenger names found');
  });

  // REAL CASE, observed in Task 1's measurement: Tesseract read Multi.pdf's `1,500.51`
  // as `1,500b1%`. Garbled text must yield a `null` amount and trip the reconciliation check —
  // it must NEVER be coerced into a plausible-looking number.
  it('yields a null amount and flags the invoice when OCR garbles the figure', () => {
    const garbled = [
      pageOf(1,
        'FOR: A/B',
        '',
        'AIR TICKETS   QR1   A B',
        'ELEC TKT      BILLED TO VIXXXX5035    1,500b1%',
        'NET CC BILLING                        1,500.51*'),
    ];
    const result = parsePassengers(garbled);
    expect(result.passengers[0].amount).toBeNull();
    expect(result.issues).toContain(
      'Passenger amounts total 0.00 but NET CC BILLING is 1500.51'
    );
  });

  // Fix round 1 — Critical 1: a corrupted figure with a stray trailing digit must NOT be
  // truncated into a shorter, plausible-looking, WRONG number.
  it('does not truncate a corrupted BILLED TO figure into a wrong number', () => {
    const truncated = [
      pageOf(1,
        'FOR: A/B',
        '',
        'AIR TICKET  X1  A B',
        'ELEC TKT  BILLED TO VI1111   1,500.512*'),
    ];
    expect(parsePassengers(truncated).passengers[0].amount).toBeNull();
  });

  it('does not truncate a corrupted NET CC BILLING figure into a wrong number', () => {
    const truncated = [
      pageOf(1,
        'FOR: A/B',
        '',
        'AIR TICKET  X1  A B',
        'ELEC TKT  BILLED TO VI1111   10.00*',
        'NET CC BILLING   1,500.512*'),
    ];
    expect(parsePassengers(truncated).netCcBilling).toBeNull();
  });

  // Fix round 1 — Critical 1 worst case, as reproduced in review: a truncated BILLED TO figure
  // that happens to equal NET CC BILLING used to sail through reconciliation with issues: [].
  it('does not let a truncated figure that matches NET CC BILLING sneak through reconciliation', () => {
    const worstCase = [
      pageOf(1,
        'FOR: A/B',
        '',
        'AIR TICKET  X1  A B',
        'ELEC TKT  BILLED TO VI1111   1,500.512*',
        'NET CC BILLING   1,500.51*'),
    ];
    const result = parsePassengers(worstCase);
    expect(result.passengers[0].amount).toBeNull();
    expect(result.issues).toContain(
      'Passenger amounts total 0.00 but NET CC BILLING is 1500.51'
    );
  });

  // Fix round 1 — Critical 2: a null passenger amount must be flagged even when NET CC BILLING
  // is ALSO unreadable, since the reconciliation check alone can't surface it in that case.
  it('flags a null passenger amount even when NET CC BILLING is also unreadable', () => {
    const bothGarbled = [
      pageOf(1,
        'FOR: A/B',
        '',
        'AIR TICKETS   QR1   A B',
        'ELEC TKT      BILLED TO VIXXXX5035    1,500b1%',
        'NET CC BILLING                        1,500b51%'),
    ];
    const result = parsePassengers(bothGarbled);
    expect(result.passengers[0].amount).toBeNull();
    expect(result.netCcBilling).toBeNull();
    expect(result.issues).toContain(
      '1 passenger amount could not be read from the scan and needs manual entry'
    );
  });

  // Fix round 1 — Important 3: pin the FOR: block terminator's dropped-slash direction. If OCR
  // drops a continuation line's slash, the block ends there rather than guessing at a name.
  it('stops the FOR: block early when a continuation line drops its slash (OCR risk)', () => {
    const droppedSlash = [
      pageOf(1,
        'FOR: PAUL/PHYLIEX JAMES',
        '     BABU ATHIRA',
        '     PAUL/MICHAELA ROSE',
        ''),
    ];
    expect(parsePassengers(droppedSlash).passengers.map((p) => p.name)).toEqual([
      'Paul/Phyliex James',
    ]);
  });

  // Fix round 1 — Important 3, the other direction: an indented slash-bearing line that isn't
  // really a continuation name would be absorbed as a phantom passenger. Pinned so this known
  // risk is visible, not silently relied upon.
  it('would absorb indented slash-bearing text as a phantom passenger (documented risk)', () => {
    const phantom = [
      pageOf(1,
        'FOR: PAUL/PHYLIEX JAMES',
        '     SOME/OTHERTEXT',
        ''),
    ];
    expect(parsePassengers(phantom).passengers.map((p) => p.name)).toEqual([
      'Paul/Phyliex James',
      'Some/Othertext',
    ]);
  });
});

/**
 * Browser-reported: "multiple passengers not recognised — only one is populated". Every fixture in
 * this file INDENTS its continuation names, so the old `if (!/^\s+\S/.test(line)) break;` guard was
 * never exercised against what a real scan produces. Running the real OCR over testDocs/Multi.pdf
 * yields the FOR: block below with NO leading whitespace on any continuation line — Tesseract in
 * PSM 6 normalises it away — so the block ended after the first name and 2 of 3 passengers were
 * silently dropped. These lines are copied verbatim from that OCR output.
 */
describe('FOR: block against real OCR output (no indentation)', () => {
  it('reads every passenger when the continuation names arrive at column 0', () => {
    const result = parsePassengers([
      pageOf(
        1,
        'SALES PERSON: BC ITINERARY/INVOICE NO. 0000243 DATE: 29 JUL 26',
        'FOR: PAUL/PHYLIEX JAMES',
        'BABU/ATHIRA',
        'PAUL/MICHAELA ROSE CHD',
        '11 SEP 26 - FRIDAY',
        'AIR OATAR AIRWAYS FLT:714 ECONOMY MEALS'
      ),
    ]);

    expect(result.passengers.map((p) => p.name)).toEqual([
      'Paul/Phyliex James',
      'Babu/Athira',
      'Paul/Michaela Rose',
    ]);
    // The CHD marker still has to survive the change.
    expect(result.passengers[2].child).toBe(true);
  });

  it('still stops at the next section rather than absorbing it as a phantom passenger', () => {
    // The date heading that follows the block carries no slash, which is what ends it now that
    // indentation is no longer consulted. Without the slash rule this line would become a name.
    const result = parsePassengers([
      pageOf(1, 'FOR: JACOB/SHIBIN THOMAS', '05 NOV 26 - THURSDAY', 'AIR ETIHAD AIRWAYS FLT:14'),
    ]);
    expect(result.passengers.map((p) => p.name)).toEqual(['Jacob/Shibin Thomas']);
  });
});

describe('OCR-damaged ticket label', () => {
  it('reads a ticket block whose AIR OCRs as ATR', () => {
    // Real output from testDocs/Multi.pdf renders the SECOND of three ticket lines as
    // "ATR TICKETS ...". A strict `AIR` matched only 2 of 3 blocks, so positional assignment gave
    // passenger 2 passenger 3's ticket number and left both without an amount.
    const result = parsePassengers([
      pageOf(
        1,
        'FOR: PAUL/PHYLIEX JAMES',
        'BABU/ATHIRA',
        'AIR TICKETS QR7544570643/44 PAUL PHYLIEX JAMES',
        'ELEC TKT BILLED TO VIXXXXXXXXXXXX5035 1,740.99*',
        'ATR TICKETS QR7544570645/46 BABU ATHIRA',
        'ELEC TKT BILLED TO VIXXXXXXXXXXXX5035 1,650.00*',
        'NET CC BILLING 3,390.99*'
      ),
    ]);

    expect(result.passengers.map((p) => [p.name, p.ticketNumber, p.amount])).toEqual([
      ['Paul/Phyliex James', 'QR7544570643/44', 1740.99],
      ['Babu/Athira', 'QR7544570645/46', 1650],
    ]);
  });
});
