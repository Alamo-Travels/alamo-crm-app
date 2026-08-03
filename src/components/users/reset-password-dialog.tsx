import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ManagedUser, setUserPassword } from '@/api/users.api';
import { errorMessage } from '@/utils/apiError';

export function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: ManagedUser | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!user) return null;
  return <ResetPasswordBody key={user.id} user={user} onOpenChange={onOpenChange} />;
}

// Separate component + key-based remount: state is seeded once by a lazy initializer,
// never by a reset effect. See CLAUDE.md's booking-edit notes.
function ResetPasswordBody({
  user,
  onOpenChange,
}: {
  user: ManagedUser;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState('');
  const mutation = useMutation({
    mutationFn: () => setUserPassword(user.id, password),
    onSuccess: () => onOpenChange(false),
  });

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Reset password — {user.name}</DialogTitle>
            <DialogDescription>
              Set a new password for this user and pass it to them directly. They are not emailed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-password" required>New password</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          {mutation.isError && (
            <p className="text-sm text-destructive">{errorMessage(mutation.error, 'Could not reset the password.')}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? 'Saving…' : 'Set password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
