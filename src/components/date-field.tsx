import { useEffect, useRef, useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatDisplayDate, parseDateInput } from '@/utils/dateFormat';

interface DateFieldProps {
  /** Accessible name — carried by the hidden native input, so label-text queries and
   * keyboard/screen-reader entry keep working exactly like a plain date input. */
  ariaLabel: string;
  /** 'YYYY-MM-DD' or '' */
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  /** Blocks submit when empty, via the hidden native input's own validation. */
  required?: boolean;
  /** Earliest selectable date, 'YYYY-MM-DD'. Omitted (the default) means any date — historic
   * bookings must stay editable, so only NEW-entry forms pass this. Applied to the calendar, the
   * hidden native input's `min`, AND the typed-entry parser (all three must agree, since the
   * native input is what carries the form value on submit). */
  minDate?: string;
  /** Applied to the field's outer wrapper, so a caller can size it (the visible input is `w-full`).
   * Used where a date sits in a fixed-width column, e.g. the invoice line-item rows. */
  className?: string;
}

/** The shadcn PopoverContent base styling, minus its Portal (see the render note below). */
const POPOVER_CONTENT_CLASS = cn(
  'z-50 w-auto rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none',
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
  'data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
  'origin-[--radix-popover-content-transform-origin]',
);

/** The nearest scrollable ancestor of `node`, or null if there is none before `<body>`.
 *
 * This is what the popover must collide against. The content is rendered INLINE (see the render
 * note below), and a shadcn `DialogContent` is BOTH `overflow-y-auto` AND `translate-*` — the
 * transform makes it the containing block for the popover's `position: fixed`, so the dialog's
 * own scroll box clips the calendar. Radix's collision middlewares default to the VIEWPORT
 * (deliberately, see `@radix-ui/react-popper`), which has room to spare below a dialog, so
 * without an explicit boundary the calendar never flips up and just lands past the dialog's edge. */
function findScrollBoundary(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el && el !== document.body) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
    el = el.parentElement;
  }
  return null;
}

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** A date input that DISPLAYS 'DD Mon YYYY' (native `<input type="date">` display format is
 * locale-controlled and can't be changed). The visible field is BOTH typeable (parsed on blur/Enter)
 * AND the trigger that opens the popover calendar — clicking it opens the calendar for a fast
 * year/month jump, while you can still type a date straight in. A visually-hidden native date input
 * carries the accessible name, form value, `required`/`min` validation, and the existing tests.
 *
 * The popover is deliberately NON-MODAL and NON-PORTALED: modal (or portaled) content would trap
 * focus / land in the pointer-events-disabled body of a parent Dialog, which would stop the field
 * from staying focused-and-typeable while the calendar is open. Rendering the content inline (the
 * Dialog content has no overflow clip) keeps it clickable inside a Dialog without a focus trap. */
export function DateField({ ariaLabel, value, onChange, id, required, minDate, className }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  // `draft` is the raw text while the user is typing; null means "not editing, show the value".
  const [draft, setDraft] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  // Resolved on open (layout can change between renders, and it costs nothing while closed).
  const [boundary, setBoundary] = useState<HTMLElement | null>(null);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  const min = minDate ? new Date(`${minDate}T00:00:00`) : undefined;

  const currentYear = new Date().getFullYear();
  const startMonth = min ?? new Date(currentYear - 100, 0, 1);
  const endMonth = new Date(currentYear + 10, 11, 31);

  const displayValue = draft ?? (value ? formatDisplayDate(value) : '');

  useEffect(() => {
    if (open) setBoundary(findScrollBoundary(anchorRef.current));
  }, [open]);

  function commitDraft() {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed === '') {
      onChange('');
      setDraft(null);
      return;
    }
    const iso = parseDateInput(trimmed);
    // Apply only a valid date that also respects minDate; otherwise revert (the calendar is the
    // always-correct fallback, and rejecting sub-minDate mirrors the calendar's disabled days).
    if (iso && (!minDate || iso >= minDate)) {
      onChange(iso);
    }
    setDraft(null);
  }

  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        type="date"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        min={minDate}
        className="absolute h-px w-px opacity-0"
        tabIndex={-1}
      />
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} className="relative">
            <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={`${ariaLabel} — type a date`}
              aria-haspopup="dialog"
              aria-expanded={open}
              placeholder="dd MMM yyyy"
              className="pl-9"
              value={displayValue}
              // Clicking the field itself opens the calendar (ArrowDown opens it for keyboard users);
              // typing straight in still works because the popover is non-modal (no focus trap).
              onClick={() => setOpen(true)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDraft();
                  setOpen(false);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                } else if (e.key === 'ArrowDown' && !open) {
                  setOpen(true);
                }
              }}
            />
          </div>
        </PopoverAnchor>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          // Flip/shift against the scrolling dialog rather than the viewport, so a field near the
          // bottom of a long form opens its calendar UPWARD instead of past the dialog's clipped
          // edge. `undefined` (not `null`) when there's no scroll container — Radix treats any
          // supplied value as "explicit boundaries" and `null` would yield an empty boundary set.
          collisionBoundary={boundary ?? undefined}
          collisionPadding={8}
          className={POPOVER_CONTENT_CLASS}
          // Keep focus in the field so the user can keep typing while the calendar is open.
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Don't close when the click/focus that "left" the calendar was actually on the field.
          onInteractOutside={(e) => {
            if (anchorRef.current && e.target instanceof Node && anchorRef.current.contains(e.target)) {
              e.preventDefault();
            }
          }}
        >
          <Calendar
            mode="single"
            captionLayout="dropdown"
            selected={selected}
            defaultMonth={selected}
            startMonth={startMonth}
            endMonth={endMonth}
            disabled={min && { before: min }}
            onSelect={(date) => {
              onChange(date ? toIso(date) : '');
              setDraft(null);
              setOpen(false);
            }}
          />
        </PopoverPrimitive.Content>
      </Popover>
    </div>
  );
}
