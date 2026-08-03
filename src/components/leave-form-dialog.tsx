import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface LeaveFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Leave this booking?" */
  title: string;
  onDiscard: () => void;
  onKeep: () => void;
}

/**
 * Cancel is genuinely ambiguous once drafts exist, so it asks instead of guessing. Nested over the
 * form it is leaving — this app already nests dialogs (Add Customer opens over the booking dialog),
 * and confirms here are Dialogs, not AlertDialogs, matching delete-booking-dialog.tsx.
 *
 * "Go back" is the default escape: Escape and a click outside both land there, so no stray
 * keystroke can destroy typed work.
 */
export function LeaveFormDialog({ open, onOpenChange, title, onDiscard, onKeep }: LeaveFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>You have unsaved changes.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            Discard it
          </Button>
          <Button type="button" onClick={onKeep}>
            Keep as draft
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Go back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
