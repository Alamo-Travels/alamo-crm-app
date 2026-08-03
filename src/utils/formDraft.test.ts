import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllDrafts,
  clearDraft,
  DRAFT_KEY_PREFIX,
  DRAFT_MAX_AGE_MS,
  readDraft,
  writeDraft,
} from './formDraft';

interface Sample {
  title: string;
}

const NOW = new Date('2026-08-03T12:00:00.000Z');

beforeEach(() => {
  localStorage.clear();
});

describe('formDraft', () => {
  it('round-trips a draft for a user', () => {
    writeDraft<Sample>('u1', 'customer', { title: 'hello' }, NOW);
    const draft = readDraft<Sample>('u1', 'customer', NOW.getTime());
    expect(draft).toEqual({ savedAt: NOW.toISOString(), state: { title: 'hello' } });
  });

  it('scopes drafts per user — user B cannot see user A\'s draft', () => {
    writeDraft<Sample>('u1', 'customer', { title: 'private' }, NOW);
    expect(readDraft<Sample>('u2', 'customer', NOW.getTime())).toBeNull();
  });

  it('scopes drafts per form key', () => {
    writeDraft<Sample>('u1', 'customer', { title: 'a' }, NOW);
    expect(readDraft<Sample>('u1', 'enquiry', NOW.getTime())).toBeNull();
  });

  it('discards a draft written by an older schema version', () => {
    localStorage.setItem(
      `${DRAFT_KEY_PREFIX}u1:customer`,
      JSON.stringify({ v: 0, savedAt: NOW.toISOString(), state: { title: 'stale' } })
    );
    expect(readDraft<Sample>('u1', 'customer', NOW.getTime())).toBeNull();
  });

  it('keeps a draft just inside the expiry window', () => {
    writeDraft<Sample>('u1', 'customer', { title: 'fresh' }, NOW);
    const justInside = NOW.getTime() + DRAFT_MAX_AGE_MS - 1;
    expect(readDraft<Sample>('u1', 'customer', justInside)).not.toBeNull();
  });

  it('discards a draft past the expiry window', () => {
    writeDraft<Sample>('u1', 'customer', { title: 'old' }, NOW);
    const justOutside = NOW.getTime() + DRAFT_MAX_AGE_MS + 1;
    expect(readDraft<Sample>('u1', 'customer', justOutside)).toBeNull();
  });

  it('discards unparseable JSON', () => {
    localStorage.setItem(`${DRAFT_KEY_PREFIX}u1:customer`, 'not json{');
    expect(readDraft<Sample>('u1', 'customer', NOW.getTime())).toBeNull();
  });

  it('returns null instead of throwing when localStorage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => readDraft<Sample>('u1', 'customer', NOW.getTime())).not.toThrow();
    expect(readDraft<Sample>('u1', 'customer', NOW.getTime())).toBeNull();
    spy.mockRestore();
  });

  it('swallows a throwing write rather than breaking the form', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeDraft<Sample>('u1', 'customer', { title: 'x' }, NOW)).not.toThrow();
    spy.mockRestore();
  });

  it('clearDraft removes only that one draft', () => {
    writeDraft<Sample>('u1', 'customer', { title: 'a' }, NOW);
    writeDraft<Sample>('u1', 'enquiry', { title: 'b' }, NOW);
    clearDraft('u1', 'customer');
    expect(readDraft<Sample>('u1', 'customer', NOW.getTime())).toBeNull();
    expect(readDraft<Sample>('u1', 'enquiry', NOW.getTime())).not.toBeNull();
  });

  it('clearAllDrafts removes that user\'s drafts but not a colleague\'s or unrelated keys', () => {
    writeDraft<Sample>('u1', 'customer', { title: 'mine' }, NOW);
    writeDraft<Sample>('u1', 'enquiry', { title: 'mine too' }, NOW);
    writeDraft<Sample>('u2', 'customer', { title: 'theirs' }, NOW);
    localStorage.setItem('alamo-theme', 'dark');

    clearAllDrafts('u1');

    expect(readDraft<Sample>('u1', 'customer', NOW.getTime())).toBeNull();
    expect(readDraft<Sample>('u1', 'enquiry', NOW.getTime())).toBeNull();
    expect(readDraft<Sample>('u2', 'customer', NOW.getTime())).not.toBeNull();
    expect(localStorage.getItem('alamo-theme')).toBe('dark');
  });
});
