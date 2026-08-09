import { describe, expect, it } from 'vitest';
import { formatItinerary, formatPax, formatSegmentDates, isGroupBookingSize } from './tripFormat';

describe('formatItinerary', () => {
  it('collapses the shared airport between consecutive legs', () => {
    expect(
      formatItinerary([
        { from: 'IAH', to: 'COK', date: '2026-08-01' },
        { from: 'COK', to: 'IAH', date: '2026-08-25' },
      ])
    ).toBe('IAH → COK → IAH');
  });

  it('does not collapse when the next leg starts somewhere else (an open-jaw)', () => {
    expect(
      formatItinerary([
        { from: 'IAH', to: 'COK', date: '2026-08-01' },
        { from: 'DXB', to: 'IAH', date: '2026-08-25' },
      ])
    ).toBe('IAH → COK → DXB → IAH');
  });

  it('returns an empty string for no segments', () => {
    expect(formatItinerary([])).toBe('');
  });

  it('skips missing airport codes', () => {
    expect(formatItinerary([{ from: 'IAH' }])).toBe('IAH');
  });
});

describe('formatPax', () => {
  it('omits zero counts', () => {
    expect(formatPax({ adults: 2, children: 0, infants: 0 })).toBe('2 ADT');
  });

  it('lists every non-zero type', () => {
    expect(formatPax({ adults: 2, children: 1, infants: 1 })).toBe('2 ADT, 1 CHD, 1 INF');
  });
});

describe('formatSegmentDates', () => {
  it('joins the dated legs in order', () => {
    expect(
      formatSegmentDates([
        { from: 'IAH', to: 'COK', date: '2026-08-01' },
        { from: 'COK', to: 'IAH', date: '2026-08-25' },
      ])
    ).toBe('01 Aug 2026 – 25 Aug 2026');
  });

  it('ignores undated legs', () => {
    expect(formatSegmentDates([{ from: 'IAH', to: 'COK' }])).toBe('');
  });
});

describe('isGroupBookingSize', () => {
  it('is false below the threshold', () => {
    expect(isGroupBookingSize({ adults: 40, children: 8, infants: 1 })).toBe(false);
  });

  it('is true exactly at the threshold', () => {
    expect(isGroupBookingSize({ adults: 50, children: 0, infants: 0 })).toBe(true);
  });

  it('is true above the threshold, summing every pax type', () => {
    expect(isGroupBookingSize({ adults: 30, children: 15, infants: 6 })).toBe(true);
  });
});
