/**
 * Divide an invoice total across `count` passengers, exact to the cent.
 *
 * All arithmetic runs in INTEGER CENTS. Splitting in floating-point dollars drifts, and rows that
 * don't add back up to the figure the user typed are worse than no split at all. Any leftover
 * cents go to the FIRST passenger, so the returned amounts always sum to exactly `total`.
 *
 * Amounts come back as the strings `PassengerRow.amount` holds, rendered the same way a stored
 * amount is already seeded into the booking form (`String(p.amount)`) — `'450'`, not a padded
 * `'450.00'`.
 */
export function splitAmount(total: number, count: number): string[] {
  if (!Number.isFinite(total) || !Number.isInteger(count) || count < 1) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return Array.from({ length: count }, (_, i) => String((i === 0 ? base + remainder : base) / 100));
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * '$1,000.00' — for the booking form's total-mismatch warning.
 *
 * Deliberately local to this feature rather than reusing `widgetFormat.ts`'s `formatWidgetValue`,
 * which is coupled to a widget aggregation and would have to be bent out of shape to serve here.
 */
export function formatUsd(amount: number): string {
  return USD.format(amount);
}
