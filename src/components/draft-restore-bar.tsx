import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/utils/dateFormat';

interface DraftRestoreBarProps {
  /** ISO timestamp the draft was written. */
  savedAt: string;
  /** Optional extra line, e.g. the customer form's "re-attach the passport file". */
  note?: string;
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * Offered at the top of a create form when a draft exists. The form itself stays EMPTY until
 * Restore is pressed — silent auto-fill was rejected in design, because it makes it easy not to
 * notice you are continuing old work and offers no obvious way to start fresh.
 *
 * Amber, matching booking-form.tsx's duplicate-invoice warning panel — the app's established
 * "attention, not an error" treatment. Same border and background, with buttons on the right.
 */
export function DraftRestoreBar({ savedAt, note, onRestore, onDiscard }: DraftRestoreBarProps) {
  const when = formatRelativeTime(savedAt);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      <History className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">
          {when ? `Unfinished draft from ${when}.` : 'You have an unfinished draft.'}
        </p>
        {note && <p className="text-muted-foreground">{note}</p>}
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={onRestore}>
          Restore
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}
