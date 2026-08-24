import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { clearDraft, FormDraftKey, readDraft, StoredDraft, writeDraft } from '@/utils/formDraft';

/** Matches the app's other debounces (300 ms search, 600 ms group-view save) in spirit: long enough
 * not to write on every keystroke, short enough that closing the dialog rarely beats it. */
const DRAFT_DEBOUNCE_MS = 500;

export interface UseFormDraftResult<T> {
  /** A stored draft on offer but not yet restored. Non-null => the restore bar shows AND writes are
   * held (see below). */
  pending: StoredDraft<T> | null;
  /** Whether the form currently holds anything worth keeping. Drives the Cancel confirmation, and
   * is the SAME predicate that decides whether to write — so the confirm and the draft can never
   * disagree about whether work exists. */
  hasContent: boolean;
  /** Hands back the stored state (for the caller to spread into its own setState calls) and clears
   * `pending`, which resumes writing. Returns null if there was nothing pending. */
  restore: () => T | null;
  /** Throws the stored draft away and resumes writing. Also the "clear on successful save" call. */
  discard: () => void;
  /** Writes what is on screen right now, overriding the held-write gate, and clears `pending`. Used
   * by the Cancel confirmation's "Keep as draft" — an explicit instruction, not an accident. */
  keep: () => void;
  /**
   * Writes to storage immediately, bypassing the debounce, and deliberately does NOT clear
   * `pending` (a restore bar must not be dismissed by this).
   *
   * Needed because a tight submit loop restarts the debounce on every `setState`, so ordinary
   * autosave may not write until the loop ends — too late if the user abandons mid-loop. Call it
   * right after a state change whose loss would be unacceptable.
   *
   * Pass `stateOverride` when the caller's closure cannot see a `setState` from earlier in the
   * same synchronous block, which is the normal case here.
   *
   * It overwrites storage even with a restore bar unresolved. That is intended: the bar renders
   * from its own in-memory snapshot, so this cannot change what is on screen, and a record of
   * genuinely posted work beats the draft it replaces. Do not add a `pending` guard.
   */
  flush: (stateOverride?: T) => void;
}

/**
 * @param key      which form this is
 * @param state    the draftable slice of the form's state; must be JSON-serialisable
 * @param isEmpty  predicate deciding "nothing worth keeping"; the hook cannot know what an empty
 *                 booking looks like. Held in a ref, so an inline arrow is safe here.
 * @param enabled  false on EDIT (drafts are create-only) and, for dialogs that never unmount, false
 *                 while closed
 */
export function useFormDraft<T>(
  key: FormDraftKey,
  state: T,
  isEmpty: (state: T) => boolean,
  enabled: boolean
): UseFormDraftResult<T> {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const active = enabled && userId !== null;

  // Held in refs so the write effect can depend on `state` alone. Without this, an inline `isEmpty`
  // arrow would change identity every render and restart the debounce timer on every render — which
  // can starve the write entirely on a form that re-renders for unrelated reasons.
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;

  const [pending, setPending] = useState<StoredDraft<T> | null>(() =>
    active && userId ? readDraft<T>(userId, key) : null
  );

  // AddEditCustomerDialog and EnquiryDialog are rendered with an `open` prop and never unmount, so
  // the lazy initialiser above would read storage once — at first mount — and never again. Re-read
  // on the closed -> open transition. (BookingForm and AdjustmentBookingForm are remounted via a
  // `key` instead, and are covered by the initialiser; this is harmless for them.)
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      setPending(userId ? readDraft<T>(userId, key) : null);
    }
    wasActive.current = active;
  }, [active, userId, key]);

  const hasContent = active && !isEmpty(state);

  useEffect(() => {
    if (!active || !userId) return;
    // THE HELD WRITE. While a draft is on offer, the form on screen is deliberately empty; writing
    // it would destroy the draft the restore bar is advertising.
    if (pending) return;
    if (isEmptyRef.current(state)) return;

    const timer = setTimeout(() => writeDraft<T>(userId, key, state), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state, pending, active, userId, key]);

  const restore = useCallback((): T | null => {
    const restored = pending?.state ?? null;
    setPending(null);
    return restored;
  }, [pending]);

  const discard = useCallback((): void => {
    if (userId) clearDraft(userId, key);
    setPending(null);
  }, [userId, key]);

  const keep = useCallback((): void => {
    if (userId && active && !isEmptyRef.current(state)) writeDraft<T>(userId, key, state);
    setPending(null);
  }, [userId, active, state, key]);

  // Deliberately does NOT check `pending` or `isEmpty`, and does NOT touch `pending` — this is a
  // narrow, explicit "persist this exact state right now" escape hatch for a caller that already
  // knows better than the debounce/held-write heuristics (see the JSDoc above). It must never be
  // reached for a form that isn't drafting at all, so `active`/`userId` are still respected.
  const flush = useCallback(
    (stateOverride?: T): void => {
      if (!active || !userId) return;
      writeDraft<T>(userId, key, stateOverride ?? state);
    },
    [active, userId, key, state]
  );

  return { pending, hasContent, restore, discard, keep, flush };
}
