import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DateField } from '@/components/date-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { BookingRow, updatePassengerPayment } from '@/api/bookings.api';

interface RecordPaymentDialogProps {
  row: BookingRow | null;
  onOpenChange: (open: boolean) => void;
  queryKeyPrefix: string;
}

export function RecordPaymentDialog({ row, onOpenChange, queryKeyPrefix }: RecordPaymentDialogProps) {
  const [status, setStatus] = useState<'paid' | 'pending'>('pending');
  const [type, setType] = useState<'card' | 'check' | 'cash'>('card');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!row) return;
    setStatus(row.paymentStatus ?? 'pending');
    setType(row.paymentType ?? 'card');
    setAmount(row.paymentAmount ? String(row.paymentAmount) : '');
    // row.paymentPaidOn may arrive as a full ISO datetime (e.g. from the API's Date
    // serialization) — <input type="date"> only accepts the YYYY-MM-DD prefix.
    setPaidOn(row.paymentPaidOn ? row.paymentPaidOn.slice(0, 10) : '');
  }, [row]);

  const mutation = useMutation({
    mutationFn: (payment: {
      status: 'paid' | 'pending';
      type: 'card' | 'check' | 'cash';
      amount: number;
      paidOn?: string;
    }) => {
      if (!row) return Promise.reject(new Error('No row selected'));
      return updatePassengerPayment(row.id, payment);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKeyPrefix] });
      onOpenChange(false);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate({
      status,
      type,
      amount: status === 'pending' ? Number(amount) : 0,
      paidOn: paidOn || undefined,
    });
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <Label>Payment status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as 'paid' | 'pending')}>
              <SelectTrigger aria-label="Payment status" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label>Payment type</Label>
            <Select value={type} onValueChange={(v) => setType(v as 'card' | 'check' | 'cash')}>
              <SelectTrigger aria-label="Payment type" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="record-payment-paid-on">Paid on</Label>
            <DateField
              id="record-payment-paid-on"
              ariaLabel="Paid on"
              value={paidOn}
              onChange={setPaidOn}
            />
          </div>
          {status === 'pending' && (
            <div className="space-y-2">
              <Label htmlFor="record-payment-amount-owed" required>Amount owed</Label>
              <Input
                id="record-payment-amount-owed"
                aria-label="Amount owed"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount owed"
                required
              />
            </div>
          )}
          {mutation.isError && <p className="text-sm text-destructive">Save failed. Check your connection and try again.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? 'Saving…' : 'Save payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
