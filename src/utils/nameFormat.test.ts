import { describe, expect, it } from 'vitest';
import { normalizeName } from './nameFormat';

describe('normalizeName', () => {
  it('title-cases an ALL-CAPS scanned name', () => {
    expect(normalizeName('JACOB/SHIBIN THOMAS')).toBe('Jacob/Shibin Thomas');
  });

  // The slash is the boundary that matters most here: the agency writes PAX names as
  // `LAST/FIRST`, so without it the given name keeps whatever case the scan had.
  it('treats the slash as a word boundary', () => {
    expect(normalizeName('POULOSE/BENNY')).toBe('Poulose/Benny');
  });

  it('treats hyphens and apostrophes as word boundaries', () => {
    expect(normalizeName("O'BRIEN/MARY-JANE")).toBe("O'Brien/Mary-Jane");
  });

  it('leaves an already title-cased name unchanged, so it is safe to apply twice', () => {
    expect(normalizeName('Jacob/Shibin Thomas')).toBe('Jacob/Shibin Thomas');
  });

  it('lowercases the tail of a mixed-case name rather than preserving it', () => {
    expect(normalizeName('jaCOB/shiBIN')).toBe('Jacob/Shibin');
  });

  it('capitalises a single-letter middle initial', () => {
    expect(normalizeName('JOSEPH/SHINY S')).toBe('Joseph/Shiny S');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeName('  BABU/ATHIRA  ')).toBe('Babu/Athira');
  });

  it('leaves an empty string alone', () => {
    expect(normalizeName('')).toBe('');
  });
});
