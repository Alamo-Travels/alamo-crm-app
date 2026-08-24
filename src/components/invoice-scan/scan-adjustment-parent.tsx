import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookingRow, listBookings } from '@/api/bookings.api';
import { ReviewInvoice } from './reviewInvoice';

interface ScanAdjustmentParentProps {
  invoice: ReviewInvoice;
  onChange: (next: ReviewInvoice) => void;
}

/**
 * Resolves which original (New) passenger a scanned Reissue/Refund adjusts. The caller gates on
 * invoice type; this does not.
 *
 * Rules, each of which has cost a real bug:
 * - The backend `q` search is an unanchored substring match on name OR PNR, so candidates must be
 *   filtered to New rows AND an exact normalized PNR. Never trust the raw response.
 * - Auto-select only on exactly one exact-PNR candidate whose name matches. A shared PNR falls to
 *   the manual picker: a wrong auto-pick attaches money to the wrong person's ledger.
 * - No original may be claimed by two rows. OCR can read two passengers identically, so each row's
 *   candidates exclude ids held by others, recomputed every render.
 * - A resolved parent clears when the PNR changes, but only once the query settles or fails
 *   terminally — `rows` is also empty while loading, so clearing on empty wipes a valid pick.
 * - The lookup PNR is `originalPnr`, seeded from the scan but separate: a reissue may be ticketed
 *   under a new PNR, and correcting a misread must not change the PNR saved on the adjustment.
 * - Must be keyed on `invoice.id`, or the refs below act on the wrong invoice mid-lookup.
 */
export default function ScanAdjustmentParent({ invoice, onChange }: ScanAdjustmentParentProps) {
  // Latest-value refs so the effect merges into the current invoice, not the one captured when a
  // lookup started. Same pattern as ScanPassengerRows.
  const invoiceRef = useRef(invoice);
  invoiceRef.current = invoice;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // No shadow state: the box's value IS `invoice.originalPnr`, so an external edit (the PNR field
  // in `scan-invoice-detail.tsx`) is reflected rather than silently diverging.
  const search = invoice.originalPnr ?? '';
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isError } = useQuery({
    queryKey: ['bookings', 'adjustment-parent', debouncedSearch],
    queryFn: () => listBookings({ q: debouncedSearch, pageSize: 50 }),
    enabled: debouncedSearch.trim().length >= 3,
  });

  /** Failed with nothing ever fetched. `isError` alone is also true for a transient blip on a PNR
   *  we already answered (TanStack keeps the last good `data`), and clearing there wipes a valid
   *  pick. */
  const lookupFailed = isError && data === undefined;

  // New rows only (an adjustment cannot be adjusted), and an exact PNR match normalized the way
  // the model stores it. This filter, not the search params, is what enforces "same PNR".
  const rows = useMemo(() => {
    const wanted = invoice.originalPnr?.trim().toUpperCase();
    if (!wanted) return [] as BookingRow[];
    return (data?.bookings ?? []).filter(
      (row) => row.bookingType === 'New' && row.pnr?.trim().toUpperCase() === wanted
    );
  }, [data, invoice.originalPnr]);

  /** Distinct PNRs the search turned up, New rows only. A substring search can match several. */
  const pnrGroups = useMemo(() => {
    const byPnr = new Map<string, BookingRow[]>();
    for (const row of data?.bookings ?? []) {
      if (row.bookingType !== 'New' || !row.pnr) continue;
      const key = row.pnr.trim().toUpperCase();
      byPnr.set(key, [...(byPnr.get(key) ?? []), row]);
    }
    return Array.from(byPnr.entries()).map(([pnr, passengers]) => ({ pnr, passengers }));
  }, [data]);

  useEffect(() => {
    // Act only once the query has settled or failed terminally. While loading, `rows` is empty for
    // the same reason a genuine no-match is, so clearing here would wipe a valid pick on every
    // refetch. A terminal failure DOES clear: we cannot confirm the new parent, and leaving the old
    // one resolved would POST the adjustment against a passenger on the wrong PNR.
    if (data === undefined && !lookupFailed) return;

    const current = invoiceRef.current;
    const validIds = new Set(rows.map((row) => row.id));

    // Drop any resolved id that is no longer a candidate, i.e. the PNR was edited. A stale id here
    // is what let Save proceed against the wrong original passenger.
    let working = current.parentPassengerIds.map((id) => (id !== null && !validIds.has(id) ? null : id));
    let changed = working.some((id, index) => id !== current.parentPassengerIds[index]);

    // Auto-select against the just-cleared array, so a corrected PNR resolves in this same pass.
    // A second effect run would never come: `rows` does not change again once settled.
    if (rows.length === 1) {
      const [only] = rows;
      // Only one scanned passenger may claim it; on an OCR name collision the lowest index wins and
      // the rest fall to the manual picker. Checked post-clear so a stale id cannot block a
      // legitimate re-select.
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

  /** Typing a new PNR un-commits the current one. `rows` then empties, which drives the
   *  stale-parent reconciliation in the effect above — the same protection a direct PNR edit
   *  already had. */
  function handleSearchChange(value: string) {
    onChange({ ...invoice, originalPnr: value });
  }

  /** Commits a PNR from the search results, and fills in whatever trip detail the scan lacks.
   *  See the file-level comment for why this is fill-if-empty and carries no `futureOnly` filter. */
  function pickGroup(group: { pnr: string; passengers: BookingRow[] }) {
    const [first] = group.passengers;
    // Only ONE arrival-date slot is in force at a time (`arrDateChoice`); fill that one, and only
    // when it is empty. Writing both would silently change which date the operator sees.
    const arrival = first.arrDate?.slice(0, 10) ?? null;
    const arrivalPatch =
      invoice.arrDateChoice === 'return'
        ? { arrDateReturn: invoice.arrDateReturn ?? arrival }
        : { arrDateFinal: invoice.arrDateFinal ?? arrival };

    onChange({
      ...invoice,
      originalPnr: group.pnr,
      airlineCode: invoice.airlineCode ?? first.airlineCode ?? null,
      depCity: invoice.depCity ?? first.depCity ?? null,
      arrCity: invoice.arrCity ?? first.arrCity ?? null,
      depDate: invoice.depDate ?? first.depDate?.slice(0, 10) ?? null,
      ...arrivalPatch,
    });
  }

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

  const searchBox = (
    <div className="space-y-1">
      <Label htmlFor="scan-original-pnr">Original PNR</Label>
      <Input
        id="scan-original-pnr"
        aria-label="Original PNR"
        value={search}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="Type at least 3 characters to find the original booking"
      />
      {/* Offered only once the current PNR has no exact match — on the happy path the scanned PNR
          resolves straight away and an extra list of near-misses would just be noise. */}
      {rows.length === 0 && pnrGroups.length > 0 && (
        <ul className="rounded-md border bg-popover text-popover-foreground shadow">
          {pnrGroups.map((group) => (
            <li key={group.pnr}>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => pickGroup(group)}
              >
                {group.pnr} — {group.passengers[0].invoiceNumber} — {group.passengers.length}{' '}
                {group.passengers.length === 1 ? 'passenger' : 'passengers'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /**
   * Everything BELOW the search box. Split out as a variable rather than four separate `return`
   * statements, because the search box must keep a STABLE position in the tree: React reconciles
   * by position, so returning `searchBox` bare in one state and `<div>{searchBox}...</div>` in
   * another unmounts and remounts the `<input>` the moment the query settles — which drops the
   * operator's focus and any keystrokes still in flight, mid-word. Found by a test whose typing
   * silently went nowhere; it is a real focus bug in a browser, not a test artifact.
   */
  const body = (() => {
    // A terminal lookup failure must LOOK different from loading. Rendering `null` here (the
    // original behaviour) was byte-for-byte identical to the pending state, so an operator whose
    // network dropped mid-review saw no signal whatsoever — while the effect above had just
    // cleared their parent pick, silently disabling Save with nothing on screen to explain why.
    if (lookupFailed) {
      return (
        <p className="text-sm text-destructive">
          Could not look up the original booking for this PNR. Check your connection and try again.
        </p>
      );
    }

    // Query still pending — say nothing ABOUT THE RESULT rather than flashing a "not found"
    // message that a moment later turns out to be wrong. The search box above always stays: it is
    // the only control the operator has, so hiding it mid-fetch would remove their only way to act.
    if (data === undefined) return null;

    if (rows.length === 0) {
      return (
        <p className="text-sm text-destructive">
          No original booking found for this PNR. Search for the correct one above.
        </p>
      );
    }

    return <ParentPickers invoice={invoice} rows={rows} onPick={pickParent} onClear={clearParent} />;
  })();

  return (
    <div className="space-y-2 rounded-md border p-3">
      {searchBox}
      {body}
    </div>
  );
}

/** The per-passenger resolution list. Extracted so the parent's single return stays readable; it
 *  holds no state and every invariant it enforces is documented on `ScanAdjustmentParent`. */
function ParentPickers({
  invoice,
  rows,
  onPick,
  onClear,
}: {
  invoice: ReviewInvoice;
  rows: BookingRow[];
  onPick: (index: number, parentId: string) => void;
  onClear: (index: number) => void;
}) {
  const anyUnresolved = invoice.parentPassengerIds.some((id) => id === null);

  return (
    <>
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
                onClick={() => onClear(index)}
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
              <Select value="" onValueChange={(value) => onPick(index, value)}>
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
    </>
  );
}
