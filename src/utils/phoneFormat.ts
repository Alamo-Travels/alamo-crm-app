/**
 * Display half of the phone rule. The storage half is `normalizePhone` in
 * alamo-crm-api/src/utils/phoneFormat.ts — the two repos share no code, so they
 * are hand-synced. Change one, change the other.
 *
 * A stored phone is a bare 10-digit US number, or any other string verbatim
 * (international numbers are never reinterpreted).
 */

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

function isInternational(value: string): boolean {
  return value.trimStart().startsWith('+');
}

/** Renders a stored phone for display: `(832)-555-1234`, or the value as-is. */
export function formatPhone(value?: string | null): string {
  if (!value) return '';
  // Checked before the digit count: a stored '+1234567890' is an international
  // number and must not be dressed up as the US number (123)-456-7890.
  if (isInternational(value)) return value;

  const digits = digitsOf(value);
  if (digits.length !== 10) return value;

  return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * What the Customers table copies to the clipboard: bare digits for a US
 * number, which paste cleanly into Sabre, a dialer or a search box. Anything
 * else is copied verbatim so an international '+' is never dropped.
 */
export function phoneCopyValue(value?: string | null): string {
  if (!value) return '';
  if (isInternational(value)) return value;

  const digits = digitsOf(value);
  return digits.length === 10 ? digits : value;
}

/**
 * Live input mask. Punctuation appears as the user types, so they only ever
 * press number keys.
 *
 * Two escape hatches keep international entry possible: a value starting with
 * '+' is passed through untouched, and more than 10 digits renders plain rather
 * than being blocked or truncated mid-keystroke.
 */
export function maskPhoneInput(raw: string): string {
  if (isInternational(raw)) return raw;

  const digits = digitsOf(raw);
  if (digits.length === 0) return '';
  if (digits.length > 10) return digits;
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)})-${digits.slice(3)}`;

  return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
