const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** Converts a native `<input type="date">` value ('YYYY-MM-DD') to the API's wire format ('DD-MMM-YYYY'). */
export function isoToDob(iso: string): string {
  const [year, month, day] = iso.split('-');
  const monthAbbr = MONTH_ABBREVIATIONS[Number(month) - 1];
  return `${day}-${monthAbbr}-${year}`;
}

/** Converts the API's wire format ('DD-MMM-YYYY') to a native `<input type="date">` value ('YYYY-MM-DD'). */
export function dobToIso(dob: string): string {
  const [day, monthAbbr, year] = dob.split('-');
  const monthIndex = MONTH_ABBREVIATIONS.findIndex((m) => m.toLowerCase() === monthAbbr.toLowerCase());
  const month = String(monthIndex + 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Converts the API's wire format ('DD-MMM-YYYY') to a 'DDMMMYYYY' string (dashes stripped), for copy-to-clipboard. */
export function dobToDigits(dob: string): string {
  return dob.replace(/-/g, '');
}

/**
 * Formats an ISO date-only ('YYYY-MM-DD') or ISO datetime
 * ('YYYY-MM-DDTHH:mm:ss.sssZ' — what a Mongoose `Date` field serializes to)
 * string for display as 'DD Mon YYYY'. Falsy or unrecognized input passes
 * through unchanged rather than being silently misformatted.
 */
export function formatDisplayDate(value: string | undefined): string {
  if (!value) return '';
  const match = ISO_DATE_PREFIX.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthAbbr = MONTH_ABBREVIATIONS[Number(month) - 1];
  if (!monthAbbr) return value;
  return `${day} ${monthAbbr} ${year}`;
}

/**
 * Formats an ISO datetime string (e.g. an audit entry's `createdAt`) for display as
 * 'DD Mon YYYY, HH:MM AM/PM' (locale-dependent time formatting via `toLocaleString`).
 * Unlike `formatDisplayDate`, this INCLUDES time-of-day — the audit log needs it because
 * two entries can land on the same calendar day, and only the time tells you their order.
 * Falsy or unparseable input passes through unchanged rather than being silently misformatted.
 */
export function formatDisplayDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The later of two 'YYYY-MM-DD' dates, ignoring blanks. Used to build a date field's lower bound
 * from more than one rule at once — e.g. an Arrival Date that must be both in the future AND on or
 * after the chosen Departure Date. Zero-padded ISO day strings sort lexicographically, so a string
 * compare is a date compare; no Date objects (and no timezone hazard) involved.
 */
export function maxIsoDate(...dates: (string | undefined)[]): string | undefined {
  const present = dates.filter((d): d is string => Boolean(d));
  return present.length ? present.reduce((a, b) => (a >= b ? a : b)) : undefined;
}

/** 1-based month number for a token like "Sep"/"September"/"sept", or null if it isn't a month name. */
function monthFromName(token: string): number | null {
  if (!/^[A-Za-z]+$/.test(token)) return null;
  const key = token.slice(0, 3).toLowerCase();
  const index = MONTH_ABBREVIATIONS.findIndex((m) => m.toLowerCase() === key);
  return index >= 0 ? index + 1 : null;
}

/** Builds a validated ISO 'YYYY-MM-DD' string, or null if the numbers don't form a real date. */
function buildIsoDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999) return null; // 4-digit years only — no century guessing
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const probe = new Date(year, month - 1, day);
  // Reject overflow (e.g. Feb 30 rolls into March): the constructed date must match the inputs.
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Leniently parses a typed date into ISO 'YYYY-MM-DD', or null if unparseable.
 * Accepts: named-month in any order ('02 Sep 1953', 'Sep 2, 1953'), packed named-month
 * ('02Sep1953', day-first), month-first numeric ('09/02/1953', '09021953'), and ISO ('1953-09-02').
 * A 4-digit year is required and the result is validated to be a real calendar date. All-numeric
 * input is MONTH-FIRST by rule.
 */
export function parseDateInput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // ISO: YYYY-MM-DD
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) return buildIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 8 packed digits: MMDDYYYY
  const packed = /^(\d{2})(\d{2})(\d{4})$/.exec(trimmed);
  if (packed) return buildIsoDate(Number(packed[3]), Number(packed[1]), Number(packed[2]));

  // Packed day + named month + year, no separators: DDMMMYYYY (e.g. "02Sep1953", "2september1953").
  // The named month makes it unambiguous, so — unlike the all-numeric case — this is DAY-first.
  const packedNamed = /^(\d{1,2})([A-Za-z]+)(\d{4})$/.exec(trimmed);
  if (packedNamed) {
    const month = monthFromName(packedNamed[2]);
    if (month === null) return null;
    return buildIsoDate(Number(packedNamed[3]), month, Number(packedNamed[1]));
  }

  const tokens = trimmed.split(/[\s,\-/.]+/).filter(Boolean);
  if (tokens.length !== 3) return null;

  // Named month anywhere; the name fixes the month, the 4-digit token is the year, the rest is the day.
  const namedIndex = tokens.findIndex((t) => monthFromName(t) !== null);
  if (namedIndex >= 0) {
    const month = monthFromName(tokens[namedIndex])!;
    const rest = tokens.filter((_, i) => i !== namedIndex);
    const yearToken = rest.find((t) => /^\d{4}$/.test(t));
    const dayToken = rest.find((t) => t !== yearToken && /^\d{1,2}$/.test(t));
    if (!yearToken || !dayToken) return null;
    return buildIsoDate(Number(yearToken), month, Number(dayToken));
  }

  // All-numeric, month-first: MM DD YYYY (last token must be the 4-digit year).
  if (tokens.every((t) => /^\d+$/.test(t))) {
    if (!/^\d{4}$/.test(tokens[2])) return null;
    return buildIsoDate(Number(tokens[2]), Number(tokens[0]), Number(tokens[1]));
  }

  return null;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Coarse "how long ago", for the draft restore bar. Returns '' for anything unparseable — the bar
 * still renders, it just doesn't claim a time. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const elapsed = now.getTime() - then;
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
