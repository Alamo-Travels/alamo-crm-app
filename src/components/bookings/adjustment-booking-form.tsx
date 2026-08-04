import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { BookingRow, createAdjustment, listBookings } from '@/api/bookings.api';
import { useBranding } from '@/hooks/useBranding';
import { agencyToday } from '@/utils/agencyTime';
import { DraftRestoreBar } from '@/components/draft-restore-bar';
import { LeaveFormDialog } from '@/components/leave-form-dialog';
import { useFormDraft } from '@/hooks/useFormDraft';
import { FormDraftKey } from '@/utils/formDraft';
import { AdjustmentSharedFields, AdjustmentSharedValue } from './adjustment-shared-fields';

interface AdjustmentBookingFormProps {
  bookingType: 'Reissue' | 'Refund';
  /** Called once every checked passenger's adjustment has been created. */
  onDone: () => void;
  onCancel: () => void;
}

interface PnrGroup {
  pnr: string;
  invoiceNumber: string;
  passengers: BookingRow[];
}

// `AdjustmentSharedValue` (from adjustment-shared-fields.tsx) IS this form's shared-fields shape —
// aliased here rather than re-declared, because it is also the persisted draft schema: a future
// divergence between two structurally-identical-by-coincidence types would silently require a
// DRAFT_SCHEMA_VERSION bump nobody would notice.
type AdjustmentShared = AdjustmentSharedValue;

export interface AdjustmentDraftState {
  pnrQuery: string;
  // WARNING: `selectedGroup` (a `PnrGroup`, which embeds `BookingRow[]`) is persisted to
  // localStorage as part of this draft. `BookingRow` is an API type declared in bookings.api.ts, so
  // a backend projection change can alter what this drafts WITHOUT anyone touching a draft file at
  // all. Any shape change here — including one driven purely by the API — requires bumping
  // `DRAFT_SCHEMA_VERSION` in src/utils/formDraft.ts, for the same reason as AdjustmentSharedValue
  // above: a stale v1 draft restoring with a missing/renamed field feeds `undefined` to a controlled
  // input or `NaN` into a numeric one.
  selectedGroup: PnrGroup | null;
  checked: Record<string, boolean>;
  amounts: Record<string, string>;
  shared: AdjustmentShared;
  /**
   * Passenger ids whose adjustment ALREADY succeeded in a partially-failed submit. Serialised as an
   * array because JSON.stringify turns a Set into {}.
   *
   * DO NOT DROP THIS FIELD. Restoring a partial failure without it makes "Retry failed" re-send the
   * passengers that already went through, and adjustments have no duplicate detection at the API —
   * the ledger is silently double-posted with nothing downstream to catch it.
   */
  succeeded: string[];
}

/** Nothing is worth keeping until a parent PNR has been picked (or at least searched for). */
function isAdjustmentDraftEmpty(state: AdjustmentDraftState): boolean {
  if (state.selectedGroup) return false;
  return state.pnrQuery.trim().length === 0;
}

/** A prefilled 'YYYY-MM-DD' date, or '' when it is absent or already in the past. Both arguments
 * are zero-padded ISO day strings, so a lexicographic compare is a date compare. */
function futureOnly(date: string | undefined, min: string): string {
  return date && date >= min ? date : '';
}

export function AdjustmentBookingForm({ bookingType, onDone, onCancel }: AdjustmentBookingFormProps) {
  // A reissue books a new, future flight, so its trip dates floor at the agency's today. The EDIT
  // dialog (edit-adjustment-dialog.tsx) deliberately passes no floor — a historic adjustment must
  // stay editable. See the same split in booking-form.tsx.
  const { timeZone } = useBranding();
  const minTripDate = agencyToday(timeZone);
  const [pnrQuery, setPnrQuery] = useState('');
  const [debouncedPnrQuery, setDebouncedPnrQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<PnrGroup | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [shared, setShared] = useState<AdjustmentShared>({
    bookingDate: new Date().toISOString().slice(0, 10),
    pnr: '',
    airlineCode: '',
    depCity: '',
    arrCity: '',
    depDate: '',
    arrDate: '',
    remark: '',
    paymentStatus: 'paid',
    paymentType: 'card',
    pendingAmount: '',
  });
  const [succeeded, setSucceeded] = useState<Set<string>>(new Set());
  const [failedNames, setFailedNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const [leaveOpen, setLeaveOpen] = useState(false);
  // Two separate draft keys, chosen by bookingType — a Reissue draft must never surface in the
  // Refund form or vice versa.
  const draftKey: FormDraftKey = bookingType === 'Reissue' ? 'booking:reissue' : 'booking:refund';
  const draftState = useMemo<AdjustmentDraftState>(
    () => ({ pnrQuery, selectedGroup, checked, amounts, shared, succeeded: Array.from(succeeded) }),
    [pnrQuery, selectedGroup, checked, amounts, shared, succeeded]
  );
  // Always a create form, so drafting is unconditionally enabled.
  const draft = useFormDraft<AdjustmentDraftState>(draftKey, draftState, isAdjustmentDraftEmpty, true);

  function handleRestoreDraft() {
    const restored = draft.restore();
    if (!restored) return;
    setPnrQuery(restored.pnrQuery);
    setSelectedGroup(restored.selectedGroup);
    setChecked(restored.checked);
    setAmounts(restored.amounts);
    setShared(restored.shared);
    // UNION the stored `succeeded` with the LIVE one — never replace. The restore bar is
    // non-blocking, so a user can leave it unresolved, type a PNR, pick a group, and submit before
    // ever clicking Restore; if p1 posts and p2 fails in that same session, live `succeeded` is
    // `{p1}`. Replacing it with the stored draft's `succeeded` (which could be `[]`, from an OLDER
    // session) would forget that p1 already posted, and "Retry failed" would re-post it — the exact
    // ledger double-post this task exists to prevent, reached through Restore instead of an abandon.
    // Both sets are simply statements of fact ("these passenger ids genuinely posted"), one from a
    // previous session and one from this one — a union of two true facts can never be wrong, and
    // can only ever prevent a re-post, never cause one. Do NOT "simplify" this back to a replace.
    setSucceeded(new Set([...succeeded, ...restored.succeeded]));
  }

  function handleCancelClick() {
    if (draft.hasContent) {
      setLeaveOpen(true);
      return;
    }
    onCancel();
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPnrQuery(pnrQuery), 300);
    return () => clearTimeout(t);
  }, [pnrQuery]);

  const { data: searchData } = useQuery({
    queryKey: ['bookings', 'pnr-search', debouncedPnrQuery],
    queryFn: () => listBookings({ q: debouncedPnrQuery, pageSize: 50 }),
    enabled: !selectedGroup && debouncedPnrQuery.trim().length >= 3,
  });

  // Only original (New) passengers are adjustable — adjustments can't be adjusted again.
  const pnrGroups = useMemo<PnrGroup[]>(() => {
    const rows = (searchData?.bookings ?? []).filter((r): r is BookingRow & { pnr: string } =>
      Boolean(r.bookingType === 'New' && r.pnr)
    );
    const byPnr = new Map<string, BookingRow[]>();
    for (const row of rows) {
      const list = byPnr.get(row.pnr) ?? [];
      list.push(row);
      byPnr.set(row.pnr, list);
    }
    return Array.from(byPnr.entries()).map(([pnr, passengers]) => ({
      pnr,
      invoiceNumber: passengers[0].invoiceNumber,
      passengers,
    }));
  }, [searchData]);

  function selectGroup(group: PnrGroup) {
    const first = group.passengers[0];
    setSelectedGroup(group);
    // Reflect the chosen PNR in the search box (the query stays disabled while a group is
    // selected, so this won't retrigger a search or reopen the results list).
    setPnrQuery(group.pnr);
    setChecked(Object.fromEntries(group.passengers.map((p) => [p.id, true])));
    setAmounts(Object.fromEntries(group.passengers.map((p) => [p.id, String(p.amount)])));
    setShared((s) => ({
      ...s,
      pnr: group.pnr,
      airlineCode: first.airlineCode ?? '',
      depCity: first.depCity ?? '',
      arrCity: first.arrCity ?? '',
      // Prefilled from the ORIGINAL flight, but dropped when it has already departed: a reissue
      // books a new future flight, so the old dates were going to be replaced anyway — and keeping
      // them would open the form already violating `minTripDate`, failing validation on a field the
      // user never touched. Cities/airline/PNR still prefill regardless (usually unchanged).
      depDate: futureOnly(first.depDate?.slice(0, 10), minTripDate),
      arrDate: futureOnly(first.arrDate?.slice(0, 10), minTripDate),
    }));
    setSucceeded(new Set());
    setFailedNames([]);
  }

  function handlePnrQueryChange(value: string) {
    setPnrQuery(value);
    if (selectedGroup) setSelectedGroup(null);
  }

  const remainingTargets = selectedGroup
    ? selectedGroup.passengers.filter((p) => checked[p.id] && !succeeded.has(p.id))
    : [];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedGroup || remainingTargets.length === 0) return;
    setSubmitting(true);
    setFailedNames([]);
    const newSucceeded = new Set(succeeded);
    const failures: string[] = [];
    for (const p of remainingTargets) {
      try {
        await createAdjustment(p.id, {
          bookingType,
          bookingDate: shared.bookingDate,
          amount: Number(amounts[p.id]),
          pnr: shared.pnr,
          airlineCode: shared.airlineCode || undefined,
          ...(bookingType === 'Reissue'
            ? {
                depCity: shared.depCity || undefined,
                arrCity: shared.arrCity || undefined,
                depDate: shared.depDate || undefined,
                arrDate: shared.arrDate || undefined,
              }
            : {}),
          remark: shared.remark || undefined,
          payment: {
            status: shared.paymentStatus,
            type: shared.paymentType,
            amount: shared.paymentStatus === 'pending' ? Number(shared.pendingAmount) : 0,
          },
        });
        newSucceeded.add(p.id);
        // Flush to React state after EACH success — NOT once after the whole loop. The draft's
        // `succeeded` must reflect what has ALREADY posted at every point during this (sequential,
        // potentially slow) loop, because the user can abandon mid-flight — Cancel (disabled below
        // while submitting, as a belt-and-braces measure) or Escape, which bypasses that entirely
        // and closes the dialog directly. Without a per-iteration flush, the draft under-reports
        // what succeeded for the whole loop duration, and restoring it re-posts passengers that
        // already went through — exactly the double-post this task exists to prevent.
        setSucceeded(new Set(newSucceeded));
        // THIS is what actually closes the window: `useFormDraft`'s ordinary autosave is
        // debounced 500ms, and every `setSucceeded` call above RESTARTS that timer rather than
        // ever letting it fire — a fast submit loop (multiple sub-500ms passenger calls) can
        // finish before the debounce ever settles, so the plain `setSucceeded` call alone does NOT
        // guarantee anything reaches storage before the user abandons. `draft.flush(...)` bypasses
        // the debounce and writes synchronously. It's passed an explicit override rather than
        // relying on `draft`'s own closed-over `state`, because this closure hasn't re-rendered
        // since `handleSubmit` started — `draft`'s `state` here is still whatever `succeeded` was
        // BEFORE this iteration, not `newSucceeded`.
        draft.flush({ pnrQuery, selectedGroup, checked, amounts, shared, succeeded: Array.from(newSucceeded) });
      } catch {
        failures.push(p.passengerName);
      }
    }
    setFailedNames(failures);
    setSubmitting(false);
    if (failures.length === 0) {
      draft.discard();
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      onDone();
    }
  }

  const submitLabel = submitting
    ? 'Saving…'
    : failedNames.length > 0
      ? 'Retry failed'
      : bookingType === 'Reissue'
        ? 'Record reissue'
        : 'Record refund';

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-3">
      {draft.pending && (
        <DraftRestoreBar
          savedAt={draft.pending.savedAt}
          onRestore={handleRestoreDraft}
          onDiscard={draft.discard}
        />
      )}
      <div className="space-y-2">
        <Label htmlFor="adjustment-pnr-search" required>Original PNR</Label>
        <Input
          id="adjustment-pnr-search"
          value={pnrQuery}
          onChange={(e) => handlePnrQueryChange(e.target.value)}
          placeholder="Type at least 3 characters to search the original PNR"
        />
        {!selectedGroup && pnrGroups.length > 0 && (
          <ul className="rounded-md border bg-popover text-popover-foreground shadow">
            {pnrGroups.map((g) => (
              <li key={g.pnr}>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => selectGroup(g)}
                >
                  {g.pnr} — {g.invoiceNumber} — {g.passengers.length}{' '}
                  {g.passengers.length === 1 ? 'passenger' : 'passengers'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!selectedGroup && searchData && debouncedPnrQuery.trim().length >= 3 && pnrGroups.length === 0 && (
          <p className="text-sm text-muted-foreground">No adjustable passengers found for this PNR.</p>
        )}
      </div>

      {selectedGroup && (
        <>
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">Passengers</p>
            {selectedGroup.passengers.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <Checkbox
                  id={`adjust-include-${p.id}`}
                  aria-label={`Include ${p.passengerName}`}
                  checked={checked[p.id] ?? false}
                  onCheckedChange={(v) => setChecked({ ...checked, [p.id]: v === true })}
                />
                <Label htmlFor={`adjust-include-${p.id}`} className="flex-1">
                  {p.passengerName}
                </Label>
                <Input
                  aria-label={`Amount for ${p.passengerName}`}
                  type="number"
                  step="0.01"
                  className="w-32"
                  value={amounts[p.id] ?? ''}
                  onChange={(e) => setAmounts({ ...amounts, [p.id]: e.target.value })}
                  disabled={!checked[p.id]}
                  required={checked[p.id]}
                />
              </div>
            ))}
          </div>

          <AdjustmentSharedFields
            bookingType={bookingType}
            value={shared}
            onChange={(patch) => setShared({ ...shared, ...patch })}
            minTripDate={minTripDate}
          />
        </>
      )}

      {failedNames.length > 0 && (
        <p className="text-sm text-destructive">
          Failed for: {failedNames.join(', ')}. Click "Retry failed" to try again.
        </p>
      )}

      <DialogFooter>
        {/* Disabled while submitting as an adjunct only — it does NOT cover Escape, which bypasses
            this button entirely, so the real fix is the per-iteration `succeeded` flush above. */}
        <Button type="button" variant="outline" onClick={handleCancelClick} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={!selectedGroup || remainingTargets.length === 0 || submitting}>
          {submitting && <Spinner />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
    <LeaveFormDialog
      open={leaveOpen}
      onOpenChange={setLeaveOpen}
      title={bookingType === 'Reissue' ? 'Leave this reissue?' : 'Leave this refund?'}
      onDiscard={() => {
        draft.discard();
        setLeaveOpen(false);
        onCancel();
      }}
      onKeep={() => {
        draft.keep();
        setLeaveOpen(false);
        onCancel();
      }}
    />
    </>
  );
}
