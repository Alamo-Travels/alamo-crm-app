import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Globe, IdCard, Mail, Phone, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DateField } from '@/components/date-field';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IconInput } from '@/components/icon-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  createCustomer,
  updateCustomer,
  getPassportDownloadUrl,
  uploadPassportFile,
  CustomerListItem,
  CustomerPassportInput,
} from '@/api/customers.api';
import { isoToDob, dobToIso } from '@/utils/dateFormat';
import { ticketingName } from '@/utils/ticketingName';

interface AddEditCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: CustomerListItem | null;
  /** Called with the new customer's ticketing name (LastName/GivenName) and id after a successful
   * create (never on edit). */
  onCreated?: (fullName: string, customerId: string) => void;
}

const emptyForm = {
  firstName: '',
  middleName: '',
  lastName: '',
  dob: '',
  gender: 'M',
  verified: false,
  phone: '',
  email: '',
  passportNumber: '',
  passportIssuingCountry: '',
  passportExpiryDate: '',
};

export function AddEditCustomerDialog({ open, onOpenChange, customer, onCreated }: AddEditCustomerDialogProps) {
  const [form, setForm] = useState(emptyForm);
  const [passportFile, setPassportFile] = useState<File | null>(null);
  const [hasExistingPhoto, setHasExistingPhoto] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [passportActionError, setPassportActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const isEdit = Boolean(customer);

  useEffect(() => {
    if (!open) return;
    setPassportFile(null);
    setFormError(null);
    setPassportActionError(null);
    if (customer) {
      setForm({
        firstName: customer.firstName,
        middleName: customer.middleName ?? '',
        lastName: customer.lastName,
        dob: dobToIso(customer.dob),
        gender: customer.gender,
        verified: customer.verified,
        phone: customer.phone ?? '',
        email: customer.email ?? '',
        passportNumber: customer.passport?.number ?? '',
        passportIssuingCountry: customer.passport?.issuingCountry ?? '',
        passportExpiryDate: customer.passport?.expiryDate ?? '',
      });
      setHasExistingPhoto(Boolean(customer.passport?.hasPhoto));
    } else {
      setForm(emptyForm);
      setHasExistingPhoto(false);
    }
  }, [open, customer]);

  const mutation = useMutation({
    mutationFn: async () => {
      const passportTouched =
        form.passportNumber.trim() || form.passportIssuingCountry.trim() || form.passportExpiryDate || passportFile;
      let passport: CustomerPassportInput | undefined;
      if (passportTouched) {
        let photoS3Key: string | undefined;
        if (passportFile) {
          photoS3Key = await uploadPassportFile(passportFile);
        }
        passport = {
          number: form.passportNumber,
          issuingCountry: form.passportIssuingCountry,
          expiryDate: form.passportExpiryDate,
          photoS3Key,
        };
      }
      const payload = {
        firstName: form.firstName,
        middleName: form.middleName || undefined,
        lastName: form.lastName,
        dob: isoToDob(form.dob),
        gender: form.gender,
        phone: form.phone || undefined,
        email: form.email || undefined,
        verified: form.verified,
        passport,
      };
      return isEdit ? updateCustomer(customer!.id, payload) : createCustomer(payload);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['customers', 'search'] });
      if (!isEdit) onCreated?.(ticketingName(form), data.id);
      onOpenChange(false);
      toast.success(isEdit ? 'Customer updated' : 'Customer created');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const passportTouched = Boolean(
      form.passportNumber.trim() || form.passportIssuingCountry.trim() || form.passportExpiryDate || passportFile
    );
    if (
      passportTouched &&
      (!form.passportNumber.trim() || !form.passportIssuingCountry.trim() || !form.passportExpiryDate)
    ) {
      setFormError('Passport number, issuing country, and expiry date are all required together.');
      return;
    }
    mutation.mutate();
  }

  async function handleViewPassport() {
    if (!customer) return;
    setPassportActionError(null);
    try {
      const url = await getPassportDownloadUrl(customer.id, false);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setPassportActionError('Could not load the passport document. Check your connection and try again.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit customer' : 'Add customer'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Personal Information</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customer-first-name" required>First name</Label>
                <IconInput
                  id="customer-first-name"
                  icon={<User />}
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  placeholder="e.g. Shiny"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-middle-name">Middle name</Label>
                <IconInput
                  id="customer-middle-name"
                  icon={<User />}
                  value={form.middleName}
                  onChange={(e) => setForm({ ...form, middleName: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-last-name" required>Last name</Label>
                <IconInput
                  id="customer-last-name"
                  icon={<User />}
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="e.g. Joseph"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customer-dob" required>Date of birth</Label>
                <DateField
                  id="customer-dob"
                  ariaLabel="Date of birth"
                  value={form.dob}
                  onChange={(dob) => setForm({ ...form, dob })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-gender">Gender</Label>
                <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
                  <SelectTrigger id="customer-gender" aria-label="Gender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">Male</SelectItem>
                    <SelectItem value="F">Female</SelectItem>
                    <SelectItem value="U">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end pb-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="customer-verified"
                    checked={form.verified}
                    onCheckedChange={(v) => setForm({ ...form, verified: !!v })}
                  />
                  <Label htmlFor="customer-verified">Verified</Label>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customer-phone">Phone</Label>
                <IconInput
                  id="customer-phone"
                  icon={<Phone />}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="e.g. +1 555 123 4567 (optional)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-email">Email</Label>
                <IconInput
                  id="customer-email"
                  icon={<Mail />}
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="name@example.com (optional)"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <h3 className="text-sm font-semibold">Passport Details</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customer-passport-number">Passport #</Label>
                <IconInput
                  id="customer-passport-number"
                  icon={<IdCard />}
                  value={form.passportNumber}
                  onChange={(e) => setForm({ ...form, passportNumber: e.target.value })}
                  placeholder="e.g. Z1234567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-passport-country">Issuing Country</Label>
                <IconInput
                  id="customer-passport-country"
                  icon={<Globe />}
                  value={form.passportIssuingCountry}
                  onChange={(e) => setForm({ ...form, passportIssuingCountry: e.target.value })}
                  placeholder="e.g. India"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-passport-expiry">Expiry Date</Label>
                <DateField
                  id="customer-passport-expiry"
                  ariaLabel="Expiry Date"
                  value={form.passportExpiryDate}
                  onChange={(passportExpiryDate) => setForm({ ...form, passportExpiryDate })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-passport-file">Upload passport</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="customer-passport-file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setPassportFile(e.target.files?.[0] ?? null)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!isEdit || !hasExistingPhoto}
                  aria-label="View passport document"
                  onClick={handleViewPassport}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </div>
              {passportActionError && <p className="text-sm text-destructive">{passportActionError}</p>}
            </div>
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}
          {mutation.isError && (
            <p className="text-sm text-destructive">Save failed. Check your connection and try again.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
