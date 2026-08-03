import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CustomerImportWizard from '@/components/CustomerImportWizard';

interface ImportCustomersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportCustomersDialog({ open, onOpenChange }: ImportCustomersDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Customers</DialogTitle>
        </DialogHeader>
        <CustomerImportWizard />
      </DialogContent>
    </Dialog>
  );
}
