import { normalizeName } from '../nameFormat';
import { OcrPage, ScannedPassenger } from './types';

export interface ParsedPassengers {
  passengers: ScannedPassenger[];
  netCcBilling: number | null;
  issues: string[];
}

/**
 * Singular on a one-passenger invoice, plural on a multi-passenger one. Both occur.
 *
 * `A[IT]R` and the `i` flag are deliberate OCR tolerance, not sloppiness: real output from
 * testDocs/Multi.pdf renders the SECOND of three ticket lines as `ATR TICKETS QR7544570645/46
 * BABU ATHIRA` — the `I` read as a `T`. A strict `AIR` matched only 2 of 3 blocks, so positional
 * assignment handed passenger 2 passenger 3's ticket number and left both without an amount.
 * The rest of the line (the word TICKETS, a ticket number, and a name) is distinctive enough that
 * widening one character cannot pull in an unrelated line.
 */
const TICKET_LABEL = /^\s*A[IT]R\s+TICKETS?\s+(\S+)\s+(.*)$/i;
const FOR_FIRST = /^\s*FOR:\s*(\S.*)$/;
/**
 * A continuation line inside the FOR: block: `LAST/FIRST MIDDLE`, optionally `CHD`.
 *
 * Stricter than "contains a slash", which was the rule while the block also required indentation.
 * Once the indentation requirement was dropped (Tesseract does not preserve it — see the loop
 * below), a bare slash test became too weak: a ticket line like
 * `AIR TICKETS QR7544570643/44 PAUL PHYLIEX JAMES` carries a slash inside its ticket number and
 * would be absorbed as a phantom passenger named after the whole line. Requiring letters-only
 * either side of the slash rejects it, because no real name contains digits. On the reference
 * scans the block is followed by a date heading, which fails this and correctly closes the block.
 */
const CONTINUATION_NAME = /^[A-Z][A-Z.'\- ]*\/[A-Z][A-Z.'\- ]*$/;
/** The `(?!\d)` after the two decimals is load-bearing: without it, an OCR-corrupted figure
 *  with a stray trailing digit (e.g. `1,500.512` from a smudged `1,500.51`) silently matches a
 *  TRUNCATED — and wrong — number instead of failing to match at all. A truncated match is worse
 *  than no match: it can coincidentally equal a truncated `NET CC BILLING` and sail through
 *  reconciliation with `issues: []`. Forcing a non-match here (→ null, caught by the two issue
 *  checks below) is the whole point of choosing an OCR engine that fails loudly. */
const NET_CC = /NET\s+CC\s+BILLING\s+([\d,]+\.\d{2})(?!\d)/;
/** The amount is the last money-shaped token on the BILLED TO line, before the trailing `*`. */
const BILLED_AMOUNT = /BILLED\s+TO\s+\S+\s+([\d,]+\.\d{2})(?!\d)\*?/;

function toNumber(value: string): number {
  return Number(value.replace(/,/g, ''));
}

function flatLines(pages: OcrPage[]): string[] {
  return pages.flatMap((page) => page.lines);
}

/**
 * The FOR: block: the first line carries the `FOR:` prefix, further passengers are indented
 * continuation lines with no prefix, and the block ends at the first blank line. Confirmed
 * against Multi.pdf (3 passengers) and Voided.pdf (2).
 */
function readForBlock(lines: string[]): { name: string; child: boolean }[] {
  const names: { name: string; child: boolean }[] = [];
  let inBlock = false;

  for (const line of lines) {
    if (!inBlock) {
      const start = FOR_FIRST.exec(line);
      if (!start) continue;
      inBlock = true;
      names.push(splitChild(start[1]));
      continue;
    }
    // A blank line closes the block on a clean scan — the documented terminator.
    if (line.trim() === '') break;
    // Defensive, NOT proven on a real scan: guards against OCR dropping the blank-line
    // delimiter itself. A line back at the left margin (no leading indent) reads as the start
    // of the next section (e.g. a flight-date line), not a continuation name, so stop rather
    // than risk absorbing unrelated text as a phantom passenger. See
    // parsePassengers.test.ts for the pinned "phantom passenger" direction.
    // NO indentation requirement. This previously broke the block on any line not starting with
    // whitespace, which read as "back at the left margin = next section". That was written against
    // indented fixtures and is WRONG on a real scan: Tesseract in PSM 6 normalises the leading
    // whitespace away, so every continuation name arrives at column 0 and the block ended after
    // the FIRST name. Browser-reported as "only one passenger is recognised"; reproduced by
    // running the real OCR over testDocs/Multi.pdf, which yields
    //   FOR: PAUL/PHYLIEX JAMES / BABU/ATHIRA / PAUL/MICHAELA ROSE CHD
    // with no indentation at all. The slash rule below is what actually separates a name from the
    // next section, and it does so without depending on whitespace the OCR does not preserve.
    // Defensive, NOT proven on a real scan: LAST/FIRST always carries a slash, so a continuation
    // line missing one is either OCR noise or a genuine continuation name whose slash was
    // itself OCR'd away. Either way this ends the block early rather than guess — a dropped
    // blank line combined with a dropped slash could otherwise absorb an unrelated line as a
    // passenger. The cost (a truncated block on the rarer OCR failure) is accepted in favor of
    // never inventing a name. See parsePassengers.test.ts for the pinned "dropped slash"
    // direction.
    if (!CONTINUATION_NAME.test(line.trim())) break;
    names.push(splitChild(line.trim()));
  }

  return names;
}

/** A trailing CHD marks a child. PAX type is computed from the customer's DOB and never
 *  stored, so the marker is stripped from the name but kept as a matching hint. */
function splitChild(raw: string): { name: string; child: boolean } {
  const trimmed = raw.trim();
  const child = /\sCHD$/.test(trimmed);
  return { name: child ? trimmed.replace(/\sCHD$/, '').trim() : trimmed, child };
}

/** One block per passenger: an `AIR TICKET(S)` line naming the passenger, then a `BILLED TO`
 *  line carrying the amount. */
function readTicketBlocks(lines: string[]): { ticketNumber: string; amount: number | null }[] {
  const blocks: { ticketNumber: string; amount: number | null }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const ticket = TICKET_LABEL.exec(lines[i]);
    if (!ticket) continue;

    let amount: number | null = null;
    // The amount sits on one of the next couple of lines (ELEC TKT / BILLED TO).
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (TICKET_LABEL.test(lines[j])) break;
      const billed = BILLED_AMOUNT.exec(lines[j]);
      if (billed) {
        amount = toNumber(billed[1]);
        break;
      }
    }
    blocks.push({ ticketNumber: ticket[1], amount });
  }

  return blocks;
}

/**
 * Pairs FOR: names with ticket blocks by POSITION.
 *
 * Ticket-line names are truncated and lose the slash (`PAUL MICHAELA ROSE C` for
 * `PAUL/MICHAELA ROSE CHD`), so they are unusable for exact matching and are not compared here.
 * A count mismatch flags the invoice rather than half-parsing it.
 */
export function parsePassengers(pages: OcrPage[]): ParsedPassengers {
  const lines = flatLines(pages);
  const names = readForBlock(lines);
  const blocks = readTicketBlocks(lines);
  const issues: string[] = [];

  if (names.length === 0) issues.push('No passenger names found');
  else if (names.length !== blocks.length) {
    issues.push(
      `Found ${names.length} passenger name${names.length === 1 ? '' : 's'} but ` +
        `${blocks.length} ticket block${blocks.length === 1 ? '' : 's'}`
    );
  }

  const passengers: ScannedPassenger[] = names.map((entry, index) => ({
    // THE one place a scanned name becomes data, and therefore the one place to normalize it.
    // A Sabre invoice prints every PAX name in caps and OCR reads it back that way, but every
    // OTHER route into the ledger stores Title Case — the bulk .xlsx importer title-cases with
    // the API's `normalizeName` (the same rule this mirrors), and the interactive booking form
    // builds the name from an already-normalized Customer record. Left raw, a scanned booking
    // sat in the ledger SHOUTING beside its neighbours.
    //
    // Normalizing HERE rather than at the display or the save site is what keeps the review
    // screen, the customer auto-match and the saved `passengerName` in agreement: the field is
    // read-only in the review UI, so nothing downstream can reintroduce the raw form. It must
    // stay BELOW the parsing above, which matches on the raw uppercase OCR text
    // (`CONTINUATION_NAME` is uppercase-only) — normalizing any earlier would break the FOR:
    // block detection outright.
    name: normalizeName(entry.name),
    child: entry.child,
    amount: blocks[index]?.amount ?? null,
    ticketNumber: blocks[index]?.ticketNumber ?? null,
    confidence: 100,
  }));

  // A null passenger amount must be surfaced on its own — the reconciliation check below only
  // fires when NET CC BILLING itself parsed, so if BOTH a passenger amount and the total are
  // garbled, that check never runs and a $0-amount passenger would otherwise reach the caller
  // with no warning at all.
  const missingAmounts = passengers.filter((p) => p.amount === null).length;
  if (missingAmounts > 0) {
    issues.push(
      `${missingAmounts} passenger amount${missingAmounts === 1 ? '' : 's'} could not be read ` +
        `from the scan and need${missingAmounts === 1 ? 's' : ''} manual entry`
    );
  }

  const netMatch = lines.map((line) => NET_CC.exec(line)).find(Boolean);
  const netCcBilling = netMatch ? toNumber(netMatch[1]) : null;

  const total = passengers.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  if (netCcBilling !== null && passengers.length > 0 && Math.abs(total - netCcBilling) > 0.005) {
    issues.push(
      `Passenger amounts total ${total.toFixed(2)} but NET CC BILLING is ${netCcBilling.toFixed(2)}`
    );
  }

  return { passengers, netCcBilling, issues };
}
