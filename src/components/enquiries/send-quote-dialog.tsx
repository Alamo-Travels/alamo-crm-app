import { FormEvent, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Enquiry, sendEnquiryQuote } from '@/api/enquiries.api';
import { farePriceSummary } from '@/utils/tripFormat';

interface SendQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enquiry: Enquiry;
}

/** Client-side approximation of the backend's quote email (kept simple — the backend renderer is
 * authoritative; this only helps staff sanity-check what goes out). */
function buildPreview(enquiry: Enquiry, selectedIndexes: number[], personalMessage: string): string {
  const parts: string[] = [`Dear ${enquiry.enquirer.name},`, "Thank you for your inquiry regarding the air ticket. I'm happy to give you the details and price you requested."];
  if (personalMessage.trim()) parts.push(personalMessage.trim());
  selectedIndexes.forEach((optionIndex, n) => {
    const option = enquiry.fareOptions[optionIndex];
    const lines = [`Option ${n + 1}:`, option.airlineName];
    lines.push(`Adult - USD${option.prices.adult.toFixed(2)} per passenger`);
    if (option.prices.child !== undefined) lines.push(`Child - USD${option.prices.child.toFixed(2)} per passenger`);
    if (option.prices.infant !== undefined) lines.push(`Infant - USD${option.prices.infant.toFixed(2)} per passenger`);
    for (const s of option.segments) {
      lines.push('', `${s.from} to ${s.to} - ${s.date}`);
      if (s.departTime) lines.push(`Depart: ${s.departTime}`);
      if (s.arriveTime) lines.push(`Arrive: ${s.arriveTime}`);
    }
    if (option.baggageNotes) lines.push('', option.baggageNotes);
    parts.push(lines.join('\n'));
  });
  parts.push("Should you have any further questions or require assistance, feel free to reach out to me. I'm here to help!");
  parts.push('Warm Regards,');
  return parts.join('\n\n');
}

export function SendQuoteDialog({ open, onOpenChange, enquiry }: SendQuoteDialogProps) {
  const queryClient = useQueryClient();
  const [toEmail, setToEmail] = useState(enquiry.enquirer.email ?? '');
  const [checked, setChecked] = useState<boolean[]>(enquiry.fareOptions.map(() => true));
  const [personalMessage, setPersonalMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset exactly once per open TRANSITION. Depending on `enquiry` identity alone would wipe the
  // success state in real usage: a successful send invalidates ['enquiries'], which prefix-matches
  // the detail page's active query, whose refetch hands this still-open dialog a NEW enquiry object.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setToEmail(enquiry.enquirer.email ?? '');
      setChecked(enquiry.fareOptions.map(() => true));
      setPersonalMessage('');
      setSending(false);
      setSentTo(null);
      setError(null);
    }
    wasOpen.current = open;
  }, [open, enquiry]);

  const selectedIndexes = checked.flatMap((isChecked, index) => (isChecked ? [index] : []));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await sendEnquiryQuote(enquiry.id, {
        toEmail,
        optionIndexes: selectedIndexes,
        ...(personalMessage.trim() ? { personalMessage: personalMessage.trim() } : {}),
      });
      setSentTo(toEmail);
      await queryClient.invalidateQueries({ queryKey: ['enquiries'] });
    } catch {
      setError('Could not send the quote. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send quote</DialogTitle>
        </DialogHeader>
        {sentTo ? (
          <div className="space-y-4">
            <p className="text-sm">Quote sent to {sentTo}</p>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="quote-to-email" required>To email</Label>
              <Input
                id="quote-to-email"
                aria-label="To email"
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Options to include</Label>
              {enquiry.fareOptions.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Checkbox
                    id={`quote-option-${index}`}
                    aria-label={`Option ${index + 1}: ${option.airlineName} — ${farePriceSummary(option)}`}
                    checked={checked[index] ?? false}
                    onCheckedChange={(v) =>
                      setChecked((prev) => prev.map((c, i) => (i === index ? v === true : c)))
                    }
                  />
                  <Label htmlFor={`quote-option-${index}`}>
                    Option {index + 1}: {option.airlineName} — {farePriceSummary(option)}
                  </Label>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <Label htmlFor="quote-personal-message">Personal message (optional)</Label>
              <Textarea
                id="quote-personal-message"
                aria-label="Personal message (optional)"
                rows={2}
                value={personalMessage}
                onChange={(e) => setPersonalMessage(e.target.value)}
                placeholder="Added after the greeting, before the options"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="quote-preview">Preview</Label>
              <pre
                id="quote-preview"
                aria-label="Email preview"
                className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-2 text-xs"
              >
                {buildPreview(enquiry, selectedIndexes, personalMessage)}
              </pre>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={sending || selectedIndexes.length === 0}>
                {sending && <Spinner />}
                {sending ? 'Sending…' : 'Send quote'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
