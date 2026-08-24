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
/**
 * The first passenger line. The capture is shaped like a PAX name (`LAST/FIRST MIDDLE`) rather
 * than "everything after FOR:", because handwriting written to the RIGHT of the FOR: block lands
 * on the same OCR line: real scans produced `FOR: MATHEW/JAMES ) NC . AY` and
 * `FOR: MATHEW/LUCY V . ~, OF`, and the whole tail was carried into the ledger and into the
 * customer match. Stopping at the first character a name cannot contain cuts the annotation off
 * without needing to know anything about what was written.
 *
 * Mirrors `CONTINUATION_NAME`'s character class deliberately — the two describe the same thing,
 * and a name the continuation rule accepts must not be rejected here.
 */
const FOR_FIRST = /^\s*FOR:\s*([A-Z][A-Z.'\- ]*\/[A-Z][A-Z.'\- ]*)/;
/**
 * A punctuation fragment left dangling once the annotation was cut off (`LUCY V .` → `LUCY V`).
 * The leading `\s+` is load-bearing: it requires the punctuation to stand alone, so a genuine
 * `JOHN JR.` keeps its full stop.
 */
const TRAILING_FRAGMENT = /\s+[.'-]+$/;
/**
 * Stray whitespace either side of the `LAST/FIRST` separator — measured as `VARGHESE /DAVIS` on a
 * real scan. Cosmetic on screen, but it breaks the exact customer-name match, so it is normalised
 * here rather than left for the operator to notice.
 *
 * Done in this file and NOT in `normalizeName`, which is hand-synced with the API's copy of the
 * same function: this is an OCR artifact, not a naming rule, and the two must not diverge.
 */
const SEPARATOR_SPACING = /\s*\/\s*/;
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
    // The block ends at a line that is not shaped like `LAST/FIRST`. There is deliberately NO
    // indentation requirement: Tesseract in PSM 6 normalises leading whitespace away, so every
    // continuation name arrives at column 0, and an indent check ended the block after the first
    // name (browser-reported, reproduced against a real scan).
    //
    // A continuation line whose slash was itself OCR'd away also ends the block. Truncating on
    // that rarer failure is preferred to absorbing an unrelated line as a phantom passenger; both
    // directions are pinned in parsePassengers.test.ts.
    if (!CONTINUATION_NAME.test(line.trim())) break;
    names.push(splitChild(line.trim()));
  }

  return names;
}

/** A trailing CHD marks a child. PAX type is computed from the customer's DOB and never
 *  stored, so the marker is stripped from the name but kept as a matching hint. */
function splitChild(raw: string): { name: string; child: boolean } {
  const trimmed = raw
    .trim()
    .replace(TRAILING_FRAGMENT, '')
    .replace(SEPARATOR_SPACING, '/')
    .trim();
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
