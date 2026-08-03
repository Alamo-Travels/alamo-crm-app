import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ManagedUser, updateUser, USERS_QUERY_KEY } from '@/api/users.api';
import { UserPermissions, useAuthStore } from '@/stores/authStore';
import { errorMessage } from '@/utils/apiError';
import { holdsPermission } from '@/utils/permissions';

type Module = keyof UserPermissions;

interface Toggle {
  module: Module;
  action: string;
  label: string;
}

/** The full tree, in display order. `restricted` marks the four an Admin does not get for free. */
const ALL_TOGGLES: Toggle[] = [
  { module: 'bookings', action: 'create', label: 'Create bookings' },
  { module: 'bookings', action: 'edit', label: 'Edit bookings' },
  { module: 'bookings', action: 'delete', label: 'Delete bookings' },
  { module: 'bookings', action: 'createAdjustment', label: 'Create reissues & refunds' },
  { module: 'bookings', action: 'viewAll', label: "View all agents' bookings" },
  { module: 'bookings', action: 'import', label: 'Import bookings' },
  { module: 'bookings', action: 'export', label: 'Export bookings' },
  { module: 'bookings', action: 'sendInvoice', label: 'Send invoices to customers' },
  { module: 'customers', action: 'create', label: 'Create customers' },
  { module: 'customers', action: 'edit', label: 'Edit customers' },
  { module: 'customers', action: 'delete', label: 'Delete customers' },
  { module: 'customers', action: 'viewPassport', label: 'View passport details' },
  { module: 'customers', action: 'import', label: 'Import customers' },
  { module: 'customers', action: 'export', label: 'Export customers' },
  { module: 'groups', action: 'createShared', label: 'Create shared groups' },
  { module: 'data', action: 'viewReports', label: 'View sales reports' },
  { module: 'enquiries', action: 'sendQuote', label: 'Send quotes to customers' },
  { module: 'enquiries', action: 'edit', label: 'Edit enquiries' },
  { module: 'enquiries', action: 'delete', label: 'Delete enquiries' },
];

/** Mirrors the backend's ADMIN_RESTRICTED set (permission.middleware.ts) — keyed on the
 *  permission PATH, never the display label, so a copy edit cannot silently drop a toggle
 *  from the Admin's dialog and make the capability ungrantable. */
const ADMIN_RESTRICTED_PATHS = new Set(['bookings.import', 'bookings.export', 'customers.import', 'customers.export']);

const MODULE_LABELS: Record<Module, string> = {
  bookings: 'Bookings',
  customers: 'Customers',
  groups: 'Groups',
  data: 'Reports',
  enquiries: 'Enquiries',
};

export function UserPermissionsDialog({
  user,
  onOpenChange,
}: {
  user: ManagedUser | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!user) return null;
  return <PermissionsBody key={user.id} user={user} onOpenChange={onOpenChange} />;
}

// Separate component + key-based remount: state is seeded once by a lazy initializer,
// never by a reset effect. See the booking-edit notes in CLAUDE.md.
function PermissionsBody({ user, onOpenChange }: { user: ManagedUser; onOpenChange: (open: boolean) => void }) {
  const [permissions, setPermissions] = useState<UserPermissions>(() => user.permissions);
  const queryClient = useQueryClient();
  const actor = useAuthStore((s) => s.user);

  const isSuperadmin = user.role === 'superadmin';
  const toggles =
    user.role === 'admin' ? ALL_TOGGLES.filter((t) => ADMIN_RESTRICTED_PATHS.has(`${t.module}.${t.action}`)) : ALL_TOGGLES;

  // A toggle is disabled (never hidden) when the CURRENT logged-in user does not hold that
  // permission themselves — mirrors the backend's grant-guard (assertCanGrantPermissions,
  // user.service.ts), which rejects turning a permission ON unless the actor already has it.
  // Leaving it checked-but-disabled is deliberate: the target may already hold it (granted by
  // someone with more access), and this dialog always sends the whole module, so a disabled
  // box must still round-trip its current value.
  const grantable = (t: Toggle): boolean => holdsPermission(actor, t.module, t.action);
  const hasUngrantableToggle = toggles.some((t) => !grantable(t));

  const mutation = useMutation({
    mutationFn: () => updateUser(user.id, { permissions }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      onOpenChange(false);
    },
  });

  function toggle(module: Module, action: string, checked: boolean): void {
    setPermissions((prev) => ({
      ...prev,
      [module]: { ...prev[module], [action]: checked },
    }));
  }

  const modules = [...new Set(toggles.map((t) => t.module))];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Permissions — {user.name}</DialogTitle>
          <DialogDescription>
            {isSuperadmin
              ? 'A Super Admin has unrestricted access to everything. There is nothing to configure.'
              : user.role === 'admin'
                ? 'An Admin can do everything except import and export data. Grant those below.'
                : 'An Agent starts with no access. Grant each capability individually.'}
          </DialogDescription>
        </DialogHeader>

        {!isSuperadmin && (
          <div className="space-y-4">
            {modules.map((module) => (
              <div key={module} className="space-y-2">
                <p className="text-sm font-semibold">{MODULE_LABELS[module]}</p>
                {toggles
                  .filter((t) => t.module === module)
                  .map((t) => {
                    const id = `${t.module}.${t.action}`;
                    const checked = Boolean((permissions[t.module] as unknown as Record<string, boolean>)[t.action]);
                    const disabled = !grantable(t);
                    return (
                      <div key={id} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(v) => toggle(t.module, t.action, v === true)}
                        />
                        <Label htmlFor={id} className={disabled ? 'font-normal text-muted-foreground' : 'font-normal'}>
                          {t.label}
                        </Label>
                      </div>
                    );
                  })}
              </div>
            ))}
            {hasUngrantableToggle && (
              <p className="text-sm text-muted-foreground">
                Greyed-out permissions are ones you do not have yourself, so you cannot grant them.
              </p>
            )}
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">{errorMessage(mutation.error, 'Could not save permissions.')}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isSuperadmin ? 'Close' : 'Cancel'}
          </Button>
          {!isSuperadmin && (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? 'Saving…' : 'Save permissions'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
