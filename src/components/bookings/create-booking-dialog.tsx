import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/stores/authStore';
import { canCreateAdjustments, canCreateBookings } from '@/utils/permissions';
import { AdjustmentBookingForm } from './adjustment-booking-form';
import { BookingForm } from './booking-form';

interface CreateBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBookingDialog({ open, onOpenChange }: CreateBookingDialogProps) {
  const user = useAuthStore((s) => s.user);
  const canNew = canCreateBookings(user);
  const canAdjustment = canCreateAdjustments(user);
  // New requires bookings.create; Reissue/Refund both require bookings.createAdjustment. The
  // dialog's default kind must be one the user can actually use — hard-defaulting to 'New' would
  // land a createAdjustment-only user on a form they can't submit, one level past the entry-point
  // gate on BookingsPage.
  const defaultKind: 'New' | 'Reissue' | 'Refund' = canNew ? 'New' : canAdjustment ? 'Reissue' : 'New';
  const [bookingKind, setBookingKind] = useState<'New' | 'Reissue' | 'Refund'>(defaultKind);

  useEffect(() => {
    if (open) setBookingKind(defaultKind);
  }, [open, defaultKind]);

  const typeSelector = (
    <>
      <Label>Booking Type</Label>
      <Select value={bookingKind} onValueChange={(v) => setBookingKind(v as 'New' | 'Reissue' | 'Refund')}>
        <SelectTrigger aria-label="Booking type" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {canNew && <SelectItem value="New">New</SelectItem>}
          {canAdjustment && <SelectItem value="Reissue">Reissue</SelectItem>}
          {canAdjustment && <SelectItem value="Refund">Refund</SelectItem>}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {bookingKind === 'New' ? 'Create booking' : bookingKind === 'Reissue' ? 'Record reissue' : 'Record refund'}
          </DialogTitle>
        </DialogHeader>
        {bookingKind === 'New' ? (
          <BookingForm
            key={open ? 'open' : 'closed'}
            typeSelector={typeSelector}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : (
          <>
            <div className="w-1/3 space-y-1 pr-2">{typeSelector}</div>
            <AdjustmentBookingForm
              key={bookingKind}
              bookingType={bookingKind}
              onDone={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
