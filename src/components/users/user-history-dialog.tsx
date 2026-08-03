import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AuditHistoryPanel } from '@/components/audit/audit-history-panel';
import { ManagedUser } from '@/api/users.api';
import { useAuthStore } from '@/stores/authStore';
import { canViewUserHistory } from '@/utils/permissions';

interface UserHistoryDialogProps {
  /** The user whose account history to show — null closes the dialog. */
  user: ManagedUser | null;
  onOpenChange: (open: boolean) => void;
}

export function UserHistoryDialog({ user, onOpenChange }: UserHistoryDialogProps) {
  const currentUser = useAuthStore((s) => s.user);
  // Belt-and-braces alongside the row-action gate in user-columns.tsx (canViewUserHistory) —
  // an Admin's query would always come back empty (the backend narrows Admins to ledger
  // actions only), so this must never render for anyone but a Super Admin.
  if (!user || !canViewUserHistory(currentUser)) return null;
  // Key-based remount (not a reset effect) so switching users re-seeds the panel's own query —
  // same convention as ResetPasswordDialog/SetActiveDialog in this folder.
  return <UserHistoryBody key={user.id} user={user} onOpenChange={onOpenChange} />;
}

function UserHistoryBody({ user, onOpenChange }: { user: ManagedUser; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>History — {user.name}</DialogTitle>
        </DialogHeader>
        <AuditHistoryPanel filter={{ targetCollection: 'users', targetId: user.id }} title="Account history" />
      </DialogContent>
    </Dialog>
  );
}
