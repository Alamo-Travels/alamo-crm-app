/**
 * Browser-local drafts for the long CREATE forms (booking, customer, enquiry, reissue, refund).
 *
 * Pure and React-free on purpose, mirroring themeStore.ts's split: every persistence rule — key
 * scoping, schema version, expiry, failure tolerance — is unit-testable without rendering anything.
 * The React binding lives in src/hooks/useFormDraft.ts.
 */

export const DRAFT_KEY_PREFIX = 'alamo-draft:v1:';

/**
 * Bump whenever ANY drafted form-state shape changes. A stored draft whose version does not match
 * is discarded silently on read — never restored into a form whose shape has moved on. These shapes
 * change often in this repo (per-passenger payment moved off the booking header; the passenger field
 * became a strict customer picker), so this is a live concern, not a formality.
 */
export const DRAFT_SCHEMA_VERSION = 1;

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type FormDraftKey = 'booking:new' | 'booking:reissue' | 'booking:refund' | 'customer' | 'enquiry';

export interface StoredDraft<T> {
  savedAt: string;
  state: T;
}

interface Envelope<T> {
  v: number;
  savedAt: string;
  state: T;
}

/** Drafts are keyed by user id because Alamo runs on shared office machines: an agent's half-typed
 * invoice (which can contain a customer's passport number) must not surface for whoever logs in
 * next. */
function storageKey(userId: string, key: FormDraftKey): string {
  return `${DRAFT_KEY_PREFIX}${userId}:${key}`;
}

function isEnvelope<T>(value: unknown): value is Envelope<T> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.v === 'number' && typeof candidate.savedAt === 'string' && 'state' in candidate;
}

/**
 * Returns null for absent, unparseable, wrong-version, expired, or an unreadable localStorage.
 * Every failure is the same silent outcome — there is no error surface for a draft that cannot be
 * read, because there is nothing the user could do about it.
 */
export function readDraft<T>(userId: string, key: FormDraftKey, now: number = Date.now()): StoredDraft<T> | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(userId, key));
  } catch {
    return null; // localStorage unavailable (privacy mode) — degrade to "no draft".
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isEnvelope<T>(parsed)) return null;
  if (parsed.v !== DRAFT_SCHEMA_VERSION) return null;

  const savedAtMs = new Date(parsed.savedAt).getTime();
  if (Number.isNaN(savedAtMs)) return null;
  if (now - savedAtMs > DRAFT_MAX_AGE_MS) return null;

  return { savedAt: parsed.savedAt, state: parsed.state };
}

export function writeDraft<T>(userId: string, key: FormDraftKey, state: T, now: Date = new Date()): void {
  const envelope: Envelope<T> = { v: DRAFT_SCHEMA_VERSION, savedAt: now.toISOString(), state };
  try {
    localStorage.setItem(storageKey(userId, key), JSON.stringify(envelope));
  } catch {
    // Best-effort persistence (quota, privacy mode). Never break the form over a failed draft.
  }
}

export function clearDraft(userId: string, key: FormDraftKey): void {
  try {
    localStorage.removeItem(storageKey(userId, key));
  } catch {
    // Nothing to do — see writeDraft.
  }
}

/**
 * Sign-out sweep. Scoped to ONE user's prefix, never the whole machine: on a shared office PC,
 * signing out must not destroy a colleague's drafts.
 */
export function clearAllDrafts(userId: string): void {
  const prefix = `${DRAFT_KEY_PREFIX}${userId}:`;
  try {
    // Collect first, then remove — removing while iterating by index reshuffles the key list.
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {
    // See writeDraft.
  }
}
