import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { readDraft, writeDraft } from '@/utils/formDraft';
import { useAuthStore } from '@/stores/authStore';
import { useFormDraft } from './useFormDraft';

interface Sample {
  title: string;
}

const isEmpty = (s: Sample): boolean => s.title.trim().length === 0;

const USER = {
  id: 'u1',
  name: 'Agent',
  email: 'a@example.com',
  role: 'agent' as const,
};

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ accessToken: 't', user: USER });
});

describe('useFormDraft', () => {
  it('writes the state after the debounce', async () => {
    const { rerender } = renderHook(
      ({ state }: { state: Sample }) => useFormDraft<Sample>('customer', state, isEmpty, true),
      { initialProps: { state: { title: '' } } }
    );

    rerender({ state: { title: 'typed' } });

    await waitFor(
      () => expect(readDraft<Sample>('u1', 'customer')?.state).toEqual({ title: 'typed' }),
      { timeout: 2000 }
    );
  });

  it('does not write an empty form', async () => {
    renderHook(() => useFormDraft<Sample>('customer', { title: '   ' }, isEmpty, true));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(readDraft<Sample>('u1', 'customer')).toBeNull();
  });

  it('offers a stored draft as pending and does not pre-fill anything', () => {
    writeDraft<Sample>('u1', 'customer', { title: 'earlier' });
    const { result } = renderHook(() => useFormDraft<Sample>('customer', { title: '' }, isEmpty, true));
    expect(result.current.pending?.state).toEqual({ title: 'earlier' });
  });

  it('HOLDS writes while a pending draft is unresolved', async () => {
    writeDraft<Sample>('u1', 'customer', { title: 'earlier' });
    const { rerender } = renderHook(
      ({ state }: { state: Sample }) => useFormDraft<Sample>('customer', state, isEmpty, true),
      { initialProps: { state: { title: '' } } }
    );

    rerender({ state: { title: 'typed over the top' } });
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(readDraft<Sample>('u1', 'customer')?.state).toEqual({ title: 'earlier' });
  });

  it('restore returns the stored state, clears pending, and resumes writing', async () => {
    writeDraft<Sample>('u1', 'customer', { title: 'earlier' });
    const { result, rerender } = renderHook(
      ({ state }: { state: Sample }) => useFormDraft<Sample>('customer', state, isEmpty, true),
      { initialProps: { state: { title: '' } } }
    );

    let restored: Sample | null = null;
    act(() => {
      restored = result.current.restore();
    });
    expect(restored).toEqual({ title: 'earlier' });
    expect(result.current.pending).toBeNull();

    rerender({ state: { title: 'edited further' } });
    await waitFor(
      () => expect(readDraft<Sample>('u1', 'customer')?.state).toEqual({ title: 'edited further' }),
      { timeout: 2000 }
    );
  });

  it('discard clears storage and resumes writing', async () => {
    writeDraft<Sample>('u1', 'customer', { title: 'earlier' });
    const { result, rerender } = renderHook(
      ({ state }: { state: Sample }) => useFormDraft<Sample>('customer', state, isEmpty, true),
      { initialProps: { state: { title: '' } } }
    );

    act(() => result.current.discard());
    expect(readDraft<Sample>('u1', 'customer')).toBeNull();

    rerender({ state: { title: 'fresh start' } });
    await waitFor(
      () => expect(readDraft<Sample>('u1', 'customer')?.state).toEqual({ title: 'fresh start' }),
      { timeout: 2000 }
    );
  });

  it('keep writes immediately, overriding the hold', () => {
    writeDraft<Sample>('u1', 'customer', { title: 'earlier' });
    const { result } = renderHook(() =>
      useFormDraft<Sample>('customer', { title: 'on screen now' }, isEmpty, true)
    );

    act(() => result.current.keep());

    expect(readDraft<Sample>('u1', 'customer')?.state).toEqual({ title: 'on screen now' });
  });

  it('re-reads the stored draft when enabled goes false -> true (dialogs that never unmount)', () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useFormDraft<Sample>('customer', { title: '' }, isEmpty, enabled),
      { initialProps: { enabled: false } }
    );
    expect(result.current.pending).toBeNull();

    writeDraft<Sample>('u1', 'customer', { title: 'saved while closed' });
    rerender({ enabled: true });

    expect(result.current.pending?.state).toEqual({ title: 'saved while closed' });
  });

  it('is inert when disabled (editing an existing record)', async () => {
    renderHook(() => useFormDraft<Sample>('customer', { title: 'edit in progress' }, isEmpty, false));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(readDraft<Sample>('u1', 'customer')).toBeNull();
  });

  it('is inert with no signed-in user', async () => {
    useAuthStore.setState({ accessToken: null, user: null });
    const { result } = renderHook(() =>
      useFormDraft<Sample>('customer', { title: 'anonymous' }, isEmpty, true)
    );
    expect(result.current.hasContent).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(readDraft<Sample>('u1', 'customer')).toBeNull();
  });

  it('reports hasContent from the emptiness predicate', () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: Sample }) => useFormDraft<Sample>('customer', state, isEmpty, true),
      { initialProps: { state: { title: '' } } }
    );
    expect(result.current.hasContent).toBe(false);

    rerender({ state: { title: 'something' } });
    expect(result.current.hasContent).toBe(true);
  });
});
