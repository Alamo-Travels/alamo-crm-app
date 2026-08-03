import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookingRow, listBookings } from '@/api/bookings.api';
import { ReviewInvoice } from './reviewInvoice';

interface ScanAdjustmentParentProps {
  invoice: ReviewInvoice;
  onChange: (next: ReviewInvoice) => void;
}

/**
 * Resolves which ORIGINAL (New) passenger a scanned Reissue/Refund invoice adjusts, by searching
 * the ledger for the scanned PNR. Only for `invoice.type === 'Reissue' | 'Refund'` — the caller
 * (`scan-invoice-detail.tsx`) is responsible for that gate; this component doesn't check it.
 *
 * **The backend's `q` search is an unanchored SUBSTRING match on either passenger name OR PNR**
 * (`bookingQuery.service.ts`) — it is NOT an exact-PNR lookup. A result can come back because its
 * PNR merely *contains* the queried text, or because its passenger name happens to match, with a
 * completely unrelated PNR. Candidates are therefore filtered to `bookingType === 'New'` (an
 * adjustment can only attach to a New passenger) **AND** an exact, case/whitespace-normalized
 * match on `row.pnr === invoice.pnr` — never on the raw search response. Every candidate offered
 * (in the picker AND the resolved confirmation below) SHOWS its PNR, mirroring
 * `adjustment-booking-form.tsx`'s precedent (`PnrGroup`, grouped and displayed by exact PNR) — so a
 * false-positive substring hit isn't just excluded silently, it would also have been visibly wrong
 * had it slipped through.
 *
 * **Auto-selects only when the search returns EXACTLY ONE exact-PNR New candidate row overall,
 * and that row's name matches the scanned passenger case-insensitively.** A PNR shared by several
 * passengers (a common family-booking case) always falls through to the manual picker below —
 * even when exactly one of those several rows happens to match by name — because the risk of a
 * wrong auto-pick (silently attaching money to the wrong person's ledger history) outweighs the
 * convenience once there's more than one name on the PNR to get confused with.
 *
 * **No original passenger can ever be claimed by two different scanned rows**, whether by
 * auto-select or a manual pick — a real risk given measured OCR name-reading unreliability (two
 * scanned passengers can end up with the identical read text). The auto-select effect tracks
 * whether the lone candidate is already claimed by an earlier index before assigning it to a
 * later one; every row's candidate list (resolved or not) excludes whatever id any OTHER row
 * currently holds, recomputed fresh on every render — never merely warns after the fact.
 *
 * **Fix round 2: a resolved row can be CORRECTED, via a per-row "Change" button.** The original
 * design collapsed to an all-or-nothing read-only summary the instant every row resolved, with no
 * way back short of re-uploading the whole PDF — a real problem, since this feature's entire
 * premise is reviewing and correcting OCR/matching output, and a misclick here silently attaches a
 * reissue/refund to the wrong person's ledger history permanently. "Change" clears that row's
 * `parentPassengerIds` slot back to `null`, reopening its picker. It deliberately does **not**
 * re-trigger auto-select — the effect below only reruns when the SEARCH RESULTS change (`[rows,
 * data]`), never when `parentPassengerIds` does — so a cleared row stays genuinely open for an explicit
 * re-pick instead of silently snapping back to whatever was just cleared. Because each row's
 * candidate list is recomputed from the CURRENT `parentPassengerIds` on every render, the
 * "never claimed twice" invariant holds automatically through any number of Change→re-pick cycles
 * — reopening one row can never let it steal an id another row still holds.
 *
 * **Fix round 3: a resolved parent no longer survives a PNR correction.** The scenario: the
 * operator resolves a parent against the OCR'd PNR, then reads the page image, sees a misread
 * character, and corrects `invoice.pnr` (via the PNR field in `scan-invoice-detail.tsx`). Before
 * this fix, nothing cleared `parentPassengerIds` when that happened — the query re-ran and the
 * panel correctly showed "No original booking found for this PNR", but the stale id was still
 * sitting there, `statusFor` still saw a resolved parent, and Save stayed enabled and would have
 * POSTed the adjustment against a passenger on the OLD PNR. Same class of bug as the round-1
 * Critical (a reissue landing on the wrong person's ledger) — arguably worse, since the panel now
 * visibly contradicts the Save button.
 *
 * The reconciliation (clear-stale-then-reauto-select) is done in the SAME effect as auto-select,
 * not a second one, and that's deliberate: two separate effects both keyed on `[rows]` would run in
 * the same commit but each read `invoiceRef.current` BEFORE the other's `onChange` has propagated
 * back through a render — a clear-effect's write is invisible to an auto-select-effect running in
 * the same pass, and since `rows` doesn't change again on its own, the auto-select half would never
 * get a second chance to fire. Doing both steps inline, in one array, sidesteps that entirely: a
 * PNR correction that resolves to exactly one new unambiguous candidate clears the stale id AND
 * re-auto-selects the correct one in the SAME `onChange` call, and the existing `claimed` dedupe is
 * evaluated against the JUST-CLEARED array, so it still holds (a stale id can't masquerade as
 * "already claimed" and block a legitimate new auto-select for that same slot).
 *
 * **Only clears once the search has stopped being "don't know yet" — never while it is merely still
 * LOADING.** `rows` is empty while loading too, exactly like a genuine no-match settle, so clearing
 * on an empty `rows` alone would wipe a perfectly valid pick on every refetch.
 *
 * **Final review C1: a TERMINAL lookup failure clears too, and renders an error line rather than
 * nothing.** A corrected PNR whose query errors outright (production's `QueryClient` retries 3
 * times before giving up) leaves `data === undefined` permanently. Early-returning on that left the
 * OLD PNR's parent id resolved while the panel rendered `null` — visually identical to loading — so
 * `statusFor` still reported `'ready'`, Save stayed enabled, and it would have POSTed the adjustment
 * against a passenger on the wrong PNR with no signal at all. The distinction that makes this safe
 * is `lookupFailed = isError && data === undefined`: TanStack RETAINS the last successful data
 * through a failed refetch, so a transient blip on a PNR we already answered keeps its `data` and is
 * deliberately excluded — that pick stays exactly where it is.
 *
 * **MUST be keyed on `invoice.id` by its caller** (see `scan-invoice-detail.tsx`'s call site) —
 * same reasoning as `ScanPassengerRows`: without a key, switching the selected invoice reuses this
 * same instance with a new `invoice` prop, and the "latest invoice/onChange" refs below would
 * silently start operating on the WRONG invoice's data for whatever lookup was already in flight.
 */
export default function ScanAdjustmentParent({ invoice, onChange }: ScanAdjustmentParentProps) {
  // "Latest" refs so the auto-select effect always merges into whatever `invoice`/`onChange` are
  // CURRENT when it runs, mirroring ScanPassengerRows' identical pattern (see that file's comment
  // for the race it guards against).
  const invoiceRef = useRef(invoice);
  invoiceRef.current = invoice;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { data, isError } = useQuery({
    queryKey: ['bookings', 'adjustment-parent', invoice.pnr],
    queryFn: () => listBookings({ q: invoice.pnr ?? '', pageSize: 50 }),
    enabled: Boolean(invoice.pnr),
  });

  /** True only when this PNR's lookup has FAILED and nothing was ever successfully fetched for it.
   * TanStack retains the last successful `data` through a later failed refetch, so `isError` alone
   * would also be true for a transient blip on a PNR we already know the answer for — clearing
   * there would wipe a perfectly valid pick. Pairing it with `data === undefined` narrows it to the
   * one case where the knowledge genuinely does not exist. */
  const lookupFailed = isError && data === undefined;

  // Only original (New) passengers are adjustable — adjustments can't be adjusted again — AND
  // only rows whose PNR EXACTLY matches the scanned one, normalized the same way the backend
  // stores it (trimmed, uppercased — see the model's schema-level `trim`/`uppercase`). The `q`
  // search itself is a substring match on name-or-PNR, so this client-side filter is what actually
  // enforces "this row really is on the same PNR", not the search parameters.
  const rows = useMemo(() => {
    const wanted = invoice.pnr?.trim().toUpperCase();
    if (!wanted) return [] as BookingRow[];
    return (data?.bookings ?? []).filter(
      (row) => row.bookingType === 'New' && row.pnr?.trim().toUpperCase() === wanted
    );
  }, [data, invoice.pnr]);

  useEffect(() => {
    // Still LOADING the current PNR's query — `rows` is empty here too, exactly like a genuine
    // no-match settle. Clearing on an empty `rows` alone would wipe a perfectly valid pick on every
    // refetch; only a query that has stopped being "don't know yet" is trustworthy enough to act on.
    //
    // A TERMINAL FAILURE counts as such, and this is the final review's C1: a corrected PNR whose
    // lookup errors outright leaves `data === undefined` forever, and early-returning here left the
    // OLD PNR's parent id resolved, `statusFor` at `'ready'`, and Save enabled — ready to POST the
    // adjustment onto a passenger on the wrong PNR. We cannot confirm the new PNR's parent, so the
    // only safe state is none. `lookupFailed` deliberately excludes a failed refetch that still has
    // cached data (see its definition) — that case must NOT clear.
    if (data === undefined && !lookupFailed) return;

    const current = invoiceRef.current;
    const validIds = new Set(rows.map((row) => row.id));

    // Step 1: null out any resolved slot whose id is no longer among the CURRENT candidates —
    // the PNR was edited and the old candidate fell out of the (now different) exact-PNR-filtered
    // result set. Leaving a stale-but-non-null id here is exactly what let Save proceed against
    // the wrong original passenger after a PNR correction.
    let working = current.parentPassengerIds.map((id) => (id !== null && !validIds.has(id) ? null : id));
    let changed = working.some((id, index) => id !== current.parentPassengerIds[index]);

    // Step 2: auto-select, evaluated against the JUST-CLEARED array from step 1 (not the original
    // prop) — so a PNR correction that resolves to exactly one new unambiguous candidate
    // re-auto-selects in this SAME pass. Waiting for a second effect run would never happen here:
    // `rows` doesn't change again on its own once settled, so nothing would retrigger it.
    if (rows.length === 1) {
      const [only] = rows;
      // Only ONE scanned passenger may claim `only` — if two scanned rows share an (OCR'd) name,
      // the first (lowest index) wins and the rest are left for the manual picker below, never
      // silently wired to the same original passenger as someone else. Checked against `working`
      // (post-clear), not the original array, so a just-cleared stale id can never masquerade as
      // "already claimed" and block a legitimate new auto-select for that same slot.
      let claimed = working.some((id) => id === only.id);
      working = current.passengers.map((passenger, index) => {
        const existing = working[index];
        if (existing) return existing;
        if (!claimed && only.passengerName.trim().toLowerCase() === passenger.name.trim().toLowerCase()) {
          claimed = true;
          changed = true;
          return only.id;
        }
        return existing;
      });
    }

    if (changed) onChangeRef.current({ ...current, parentPassengerIds: working });
  }, [rows, data, lookupFailed]);

  function pickParent(index: number, parentId: string) {
    const nextParentIds = [...invoice.parentPassengerIds];
    nextParentIds[index] = parentId;
    onChange({ ...invoice, parentPassengerIds: nextParentIds });
  }

  /** Reopens a resolved row for re-picking — see the file-level comment on why this deliberately
   * does not (and must not) re-trigger the auto-select effect. */
  function clearParent(index: number) {
    const nextParentIds = [...invoice.parentPassengerIds];
    nextParentIds[index] = null;
    onChange({ ...invoice, parentPassengerIds: nextParentIds });
  }

  if (!invoice.pnr) return null;

  // A terminal lookup failure must LOOK different from loading. Rendering `null` here (the original
  // behaviour) was byte-for-byte identical to the pending state, so an operator whose network
  // dropped mid-review saw no signal whatsoever — while the effect above had just cleared their
  // parent pick, silently disabling Save with nothing on screen to explain why.
  if (lookupFailed) {
    return (
      <p className="text-sm text-destructive">
        Could not look up the original booking for this PNR. Check your connection and try again.
      </p>
    );
  }

  // Query still pending — say nothing rather than flashing a "not found" message that a moment
  // later turns out to be wrong.
  if (data === undefined) return null;

  if (rows.length === 0) {
    return <p className="text-sm text-destructive">No original booking found for this PNR.</p>;
  }

  const anyUnresolved = invoice.parentPassengerIds.some((id) => id === null);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">
        {anyUnresolved ? 'Choose the original passenger' : 'Original passenger resolved'}
      </p>
      {invoice.passengers.map((passenger, index) => {
        const parentId = invoice.parentPassengerIds[index];
        // Whatever id any OTHER row currently holds — recomputed fresh from CURRENT state every
        // render, so this stays correct through any number of Change→re-pick cycles.
        const takenElsewhere = new Set(
          invoice.parentPassengerIds.filter((id, i): id is string => id !== null && i !== index)
        );

        if (parentId) {
          const row = rows.find((r) => r.id === parentId);
          return (
            <div
              key={index}
              className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-50 p-2 text-sm dark:bg-emerald-950/20"
            >
              <span>
                {passenger.name} → {row ? `${row.pnr} — ${row.passengerName} — ${row.invoiceNumber}` : 'resolved'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Change original passenger for ${passenger.name}`}
                onClick={() => clearParent(index)}
              >
                Change
              </Button>
            </div>
          );
        }

        const candidates = rows.filter((row) => !takenElsewhere.has(row.id));

        return (
          <div key={index} className="space-y-1">
            <Label htmlFor={`scan-adjustment-parent-${index}`}>{passenger.name}</Label>
            {candidates.length === 0 ? (
              <p className="text-sm text-destructive">
                No remaining unclaimed original passenger for this PNR — every candidate is already
                assigned to another row.
              </p>
            ) : (
              <Select value="" onValueChange={(value) => pickParent(index, value)}>
                <SelectTrigger
                  id={`scan-adjustment-parent-${index}`}
                  aria-label={`Original passenger for ${passenger.name}`}
                >
                  <SelectValue placeholder="Select the original passenger" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.pnr} — {row.passengerName} — {row.invoiceNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      })}
    </div>
  );
}
