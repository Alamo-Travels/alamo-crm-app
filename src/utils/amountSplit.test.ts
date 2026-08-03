import { describe, expect, it } from 'vitest';
import { formatUsd, splitAmount } from './amountSplit';

/** Sum the returned strings back up in cents — comparing floats would drift. */
function sumCents(amounts: string[]): number {
  return amounts.reduce((sum, a) => sum + Math.round(Number(a) * 100), 0);
}

describe('splitAmount', () => {
  it('divides evenly when it can', () => {
    expect(splitAmount(900, 2)).toEqual(['450', '450']);
  });

  // The rows must always add back up to what the user typed, so the odd cents have to land
  // somewhere. Passenger 1 takes them.
  it('puts the leftover cents on the first passenger', () => {
    const amounts = splitAmount(1000, 3);
    expect(amounts).toEqual(['333.34', '333.33', '333.33']);
    expect(sumCents(amounts)).toBe(100000);
  });

  it('gives a single passenger the whole total', () => {
    expect(splitAmount(742.5, 1)).toEqual(['742.5']);
  });

  it('splits zero into zeroes', () => {
    expect(splitAmount(0, 3)).toEqual(['0', '0', '0']);
  });

  // A total typed with sub-cent precision rounds to cents before dividing, so the parts still
  // reconcile exactly.
  it('rounds a sub-cent total to cents first', () => {
    const amounts = splitAmount(100.005, 2);
    expect(sumCents(amounts)).toBe(10001);
  });

  it('returns nothing for an unusable input', () => {
    expect(splitAmount(Number.NaN, 2)).toEqual([]);
    expect(splitAmount(900, 0)).toEqual([]);
  });

  // `count` is always `passengers.length` in practice, but the function's whole purpose is exact
  // integer-cent arithmetic — a non-integer count must be structurally impossible to use, not just
  // unreachable by convention.
  it('returns nothing for a non-integer count', () => {
    expect(splitAmount(900, 2.9)).toEqual([]);
  });
});

describe('formatUsd', () => {
  it('renders dollars with a thousands separator and two decimals', () => {
    expect(formatUsd(1000)).toBe('$1,000.00');
    expect(formatUsd(333.3)).toBe('$333.30');
  });
});
