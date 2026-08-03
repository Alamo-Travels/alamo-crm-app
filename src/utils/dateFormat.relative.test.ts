import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './dateFormat';

const NOW = new Date('2026-08-03T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('reads "just now" under a minute', () => {
    expect(formatRelativeTime('2026-08-03T11:59:30.000Z', NOW)).toBe('just now');
  });

  it('reads minutes', () => {
    expect(formatRelativeTime('2026-08-03T11:45:00.000Z', NOW)).toBe('15 minutes ago');
  });

  it('singularises one minute', () => {
    expect(formatRelativeTime('2026-08-03T11:59:00.000Z', NOW)).toBe('1 minute ago');
  });

  it('reads hours', () => {
    expect(formatRelativeTime('2026-08-03T10:00:00.000Z', NOW)).toBe('2 hours ago');
  });

  it('reads yesterday', () => {
    expect(formatRelativeTime('2026-08-02T10:00:00.000Z', NOW)).toBe('yesterday');
  });

  it('reads days', () => {
    expect(formatRelativeTime('2026-07-31T10:00:00.000Z', NOW)).toBe('3 days ago');
  });

  it('passes an unparseable value through as empty', () => {
    expect(formatRelativeTime('not a date', NOW)).toBe('');
  });
});
