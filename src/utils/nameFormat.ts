/**
 * Capitalises the first letter of each word and lowercases the rest, treating space, `-`, `'` and
 * `/` as word boundaries: `"JACOB/SHIBIN THOMAS"` -> `"Jacob/Shibin Thomas"`, `"o'brien"` ->
 * `"O'Brien"`, `"MARY-JANE"` -> `"Mary-Jane"`.
 *
 * **Hand-synced twin of the API's `src/utils/nameFormat.ts`** — the two repos share no code, the
 * same arrangement as `phoneFormat.ts`. Keep the two implementations identical: the backend
 * title-cases PAX names on bulk `.xlsx` import with this exact rule, so a name that arrives by a
 * different route must land in the ledger looking the same or the two import paths visibly
 * disagree.
 *
 * The `/` boundary is the one that matters most here: the agency writes PAX names in `LAST/FIRST`
 * form, and without it the given name would keep whatever case it was scanned in.
 *
 * Idempotent — applying it to an already-normalized name is a no-op, so it is safe at any layer.
 */
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'/-])([a-z])/g, (_match, sep: string, letter: string) => `${sep}${letter.toUpperCase()}`);
}
