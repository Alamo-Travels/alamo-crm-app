import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getBooking } from '@/api/bookings.api';
import { AuditHistoryPanel } from '@/components/audit/audit-history-panel';
import { useAuthStore } from '@/stores/authStore';
import { canViewAudit } from '@/utils/permissions';
import { BookingForm } from './booking-form';

interface EditBookingDialogProps {
  /** The Booking id to edit — null closes the dialog. */
  bookingId: string | null;
  onOpenChange: (open: boolean) => void;
  queryKeyPrefix: string;
}

export function EditBookingDialog({ bookingId, onOpenChange, queryKeyPrefix }: EditBookingDialogProps) {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, isError } = useQuery({
    queryKey: [queryKeyPrefix, 'detail', bookingId],
    queryFn: () => getBooking(bookingId as string),
    enabled: bookingId !== null,
  });

  return (
    <Dialog open={bookingId !== null} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit booking{data ? ` #${data.booking.invoiceNumber}` : ''}</DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="text-sm text-destructive">Could not load this booking.</p>}
        {data && (
          // Keyed by booking id so switching rows re-seeds the form rather than reusing
          // the previous booking's state.
          <BookingForm
            key={data.booking.id}
            initial={data}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
        {/* bookingRef, NOT targetId — an invoice's history spans the Booking header AND its
            passengers, including a passenger that's since been deleted (whose id the frontend
            no longer has). The backend supports bookingRef as an $or across both. */}
        {canViewAudit(user) && bookingId && (
          <div className="mt-6 border-t pt-4">
            <AuditHistoryPanel filter={{ bookingRef: bookingId }} title="Invoice history" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
