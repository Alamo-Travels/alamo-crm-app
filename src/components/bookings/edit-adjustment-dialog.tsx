import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { AdjustmentDetail, UpdateAdjustmentInput, getAdjustment, updateAdjustment } from '@/api/bookings.api';
import { errorMessage } from '@/utils/apiError';
import { AdjustmentSharedFields, AdjustmentSharedValue } from './adjustment-shared-fields';

interface EditAdjustmentDialogProps {
  /** The adjustment's passenger id — null closes the dialog. */
  adjustmentId: string | null;
  onOpenChange: (open: boolean) => void;
  queryKeyPrefix: string;
}

function sharedFrom(detail: AdjustmentDetail): AdjustmentSharedValue {
  return {
    bookingDate: detail.bookingDate,
    pnr: detail.pnr,
    airlineCode: detail.airlineCode ?? '',
    depCity: detail.depCity ?? '',
    arrCity: detail.arrCity ?? '',
    depDate: detail.depDate ?? '',
    arrDate: detail.arrDate ?? '',
    remark: detail.remark ?? '',
    paymentStatus: detail.payment.status,
    paymentType: detail.payment.type,
    // `!= null` (not truthy) so a pending payment stored with amount 0 still seeds '0', not ''
    // into this `required` input.
    pendingAmount: detail.payment.amount != null ? String(detail.payment.amount) : '',
  };
}

interface AdjustmentEditFormProps {
  detail: AdjustmentDetail;
  onDone: () => void;
  onCancel: () => void;
  queryKeyPrefix: string;
}

/** Owns the actual form state, seeded once from `detail` via a lazy initializer — no
 * reset-on-`detail`-change effect. `detail` comes from a TanStack Query in the parent dialog, and
 * this form's own `onSuccess` invalidates `[queryKeyPrefix]`; a background refetch mid-edit would
 * hand this component a new `detail` object identity and (if an effect watched it) silently wipe
 * whatever the user had typed. `EditAdjustmentDialog` instead remounts this component whenever the
 * adjustment id changes (keyed by `detail.id`), so this lazy initializer already re-seeds correctly
 * on a genuine "different adjustment" without needing an effect at all — the same pattern already
 * used by `booking-form.tsx`/`EditBookingDialog` (see that file's comment for the history: this
 * exact class of bug was fixed once already in this codebase, in `send-quote-dialog.tsx`). */
function AdjustmentEditForm({ detail, onDone, onCancel, queryKeyPrefix }: AdjustmentEditFormProps) {
  const [shared, setShared] = useState<AdjustmentSharedValue>(() => sharedFrom(detail));
  const [amount, setAmount] = useState(() => String(detail.amount));
  // Round-tripped invisibly, same as booking-form.tsx's `form.paidOn` — this dialog has no "paid
  // on" control of its own (that only exists in record-payment-dialog.tsx), but
  // `PATCH /passengers/:id` replaces `payment` as a whole object, so omitting it here would erase
  // an existing paid-on date the moment any other field on this adjustment is edited. Deliberately
  // NOT part of `AdjustmentSharedValue`/`AdjustmentSharedFields`, since that type is also used by
  // the CREATE-only `adjustment-booking-form.tsx`, which has nothing to preserve.
  const [paidOn] = useState(() => detail.payment.paidOn ?? '');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdateAdjustmentInput) => updateAdjustment(detail.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKeyPrefix] });
      onDone();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate({
      bookingDate: shared.bookingDate,
      amount: Number(amount),
      pnr: shared.pnr,
      airlineCode: shared.airlineCode || undefined,
      // A Refund renders no trip-detail inputs (same rule as the create form) — but `shared` was
      // seeded from `detail` regardless of bookingType (see `sharedFrom`), and a Refund can
      // legitimately have depCity/arrCity/depDate/arrDate on file if it was imported. Omitting
      // these unconditionally for a Refund would wipe that stored data via the wholesale PATCH the
      // moment any OTHER field (e.g. just the pnr) is edited, even though the user never touched —
      // or even saw — these fields. Only include the ones that actually have a value, so a Refund
      // with nothing on file still sends none of these keys (matching the create form's contract).
      ...(shared.depCity ? { depCity: shared.depCity } : {}),
      ...(shared.arrCity ? { arrCity: shared.arrCity } : {}),
      ...(shared.depDate ? { depDate: shared.depDate } : {}),
      ...(shared.arrDate ? { arrDate: shared.arrDate } : {}),
      remark: shared.remark || undefined,
      payment: {
        status: shared.paymentStatus,
        type: shared.paymentType,
        amount: shared.paymentStatus === 'pending' ? Number(shared.pendingAmount) : 0,
        // Round-tripped invisibly — see the `paidOn` state comment above.
        paidOn: paidOn || undefined,
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* The parent passenger is fixed — shown, never editable. */}
      <p className="text-sm text-muted-foreground">Passenger: {detail.passengerName}</p>
      <div className="space-y-1">
        <Label htmlFor="edit-adjustment-amount" required>Amount</Label>
        <Input
          id="edit-adjustment-amount"
          aria-label="Adjustment amount"
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <AdjustmentSharedFields
        bookingType={detail.bookingType}
        value={shared}
        onChange={(patch) => setShared({ ...shared, ...patch })}
      />
      {mutation.isError && (
        <p className="text-sm text-destructive">
          {errorMessage(mutation.error, 'Save failed. Check your connection and try again.')}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditAdjustmentDialog({ adjustmentId, onOpenChange, queryKeyPrefix }: EditAdjustmentDialogProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: [queryKeyPrefix, 'adjustment', adjustmentId],
    queryFn: () => getAdjustment(adjustmentId as string),
    enabled: adjustmentId !== null,
  });

  return (
    <Dialog open={adjustmentId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data ? `Edit ${data.bookingType.toLowerCase()}` : 'Edit adjustment'}</DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="text-sm text-destructive">Could not load this adjustment.</p>}
        {data && (
          // Keyed by adjustment id so switching rows re-seeds the form rather than reusing the
          // previous adjustment's state; a background refetch of the SAME id keeps the same key,
          // so it does NOT remount or wipe in-progress edits (see AdjustmentEditForm's comment).
          <AdjustmentEditForm
            key={data.id}
            detail={data}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
            queryKeyPrefix={queryKeyPrefix}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
