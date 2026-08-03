import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import BookingImportWizard from '@/components/BookingImportWizard';

interface ImportBookingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportBookingsDialog({ open, onOpenChange }: ImportBookingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Bookings</DialogTitle>
        </DialogHeader>
        <BookingImportWizard />
      </DialogContent>
    </Dialog>
  );
}
