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
   * Writes to storage IMMEDIATELY, bypassing the 500 ms debounce — and, unlike `keep`, does NOT
   * touch `pending` (a restore bar must not be dismissed by this).
   *
   * For a form whose state changes in a tight, fast loop (e.g. one API call per row in a
   * sequential submit), every `setState` call restarts the debounce timer rather than ever letting
   * it fire — if the loop is faster than 500 ms of quiescence, ordinary autosave may never write
   * at all until the whole loop finishes, which is too late if the user abandons mid-loop.
   * `flush()` is the escape hatch: call it right after a state change whose loss would be
   * unacceptable (e.g. right after a row's own the API call has already succeeded).
   *
   * Accepts an optional explicit `stateOverride` — take it when the caller's own closure cannot
   * see the JUST-updated value yet (a `setState` call earlier in the same synchronous block has not
   * re-rendered), which is the normal case for exactly the scenario this exists for. Falls back to
   * the hook's own `state` prop (the value as of the render that produced this `flush` reference)
   * when omitted.
   *
   * `pending` (an unresolved restore bar) is NOT guaranteed to be null when `flush` is called — the
   * bar is non-blocking, so a user can leave it unresolved, submit anyway, and have this fire mid
   * submit. `flush` overwrites storage regardless, and that is the intended, accepted trade-off, not
   * an oversight: the restore bar renders from its own in-memory `pending` SNAPSHOT, not from
   * storage, so overwriting storage does not change what is currently on screen — and the record
   * that replaces the old one is a statement of genuinely-posted work, which is more valuable than
   * whatever the overwritten draft held. Do not add a `pending` guard here to "protect" the bar; it
   * needs no protection, and the caller (`adjustment-booking-form.tsx`) separately unions rather
   * than replaces `succeeded` on restore for the same reason.
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
