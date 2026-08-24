import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface LeaveScanDialogProps {
  open: boolean;
  /** Cancel the navigation and stay on the review screen. */
  onStay: () => void;
  /** Let the navigation through, discarding the whole review. */
  onLeave: () => void;
}

/**
 * Confirms leaving `/bookings/scan` while a scan is still unsaved.
 *
 * Deliberately NOT `LeaveFormDialog`: that one's middle button is "Keep as draft", and a scan
 * review has no draft to keep — the parsed invoices live only in page state, so leaving really
 * does discard them (draft persistence is a parked item in the invoice-scan improvement backlog).
 * Offering a "Keep as draft" that silently kept nothing would be worse than not offering it.
 *
 * "Stay on this page" is the safe default: Escape and a click outside both resolve to it, so no
 * stray keystroke can throw away a batch that took minutes to OCR. Same rule as `LeaveFormDialog`,
 * where the non-destructive outcome owns the dismiss paths.
 */
export function LeaveScanDialog({ open, onStay, onLeave }: LeaveScanDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onStay();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Leave the scanned invoices?</DialogTitle>
          <DialogDescription>
            The scanned invoices and every correction you have made are not saved yet. Leaving this
            page discards them, and the PDF has to be uploaded and read again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="destructive" onClick={onLeave}>
            Leave and discard
          </Button>
          <Button type="button" onClick={onStay}>
            Stay on this page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
