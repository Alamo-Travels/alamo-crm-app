import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Baby, Clock, Luggage, Plane, PlaneLanding, PlaneTakeoff, User, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label, RequiredMark } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CodeSearchField } from '@/components/code-search-field';
import { DateField } from '@/components/date-field';
import { searchAirlines, searchAirports } from '@/api/flightData.api';
import { EnquiryFareOption, EnquirySegment } from '@/api/enquiries.api';
import { useBranding } from '@/hooks/useBranding';
import { agencyToday } from '@/utils/agencyTime';
import { maxIsoDate } from '@/utils/dateFormat';
import { cn } from '@/lib/utils';

const SEGMENT_GRID = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_152px_92px_92px_auto] items-center gap-2';

// 24hr only: 00:00–23:59. A native <input type="time"> renders an AM/PM spinner on a
// US-locale machine and offers no way to force 24hr, so this is a masked text input instead.
const HHMM_PATTERN = '([01]\\d|2[0-3]):[0-5]\\d';

interface FareOptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, edits this option; otherwise creates a new one. */
  initial?: EnquiryFareOption | null;
  onSave: (option: EnquiryFareOption) => void;
}

interface SegmentForm {
  from: string;
  to: string;
  date: string;
  departTime: string;
  arriveTime: string;
}

const EMPTY_SEGMENT: SegmentForm = { from: '', to: '', date: '', departTime: '', arriveTime: '' };

/** A blank fare is NOT a zero fare — an unquoted child price must be absent from the quote,
 * not printed to the customer as USD0.00. */
function optionalPrice(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

interface FareInputProps {
  id: string;
  label: string;
  ariaLabel: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

function FareInput({ id, label, ariaLabel, icon, value, onChange, required }: FareInputProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="flex items-center gap-1.5" required={required}>
        {icon}
        {label}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground">$</span>
        <Input
          id={id}
          aria-label={ariaLabel}
          type="number"
          min={0}
          step="0.01"
          className="pl-6"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        />
      </div>
    </div>
  );
}

interface TimeInputProps {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}

function TimeInput({ ariaLabel, value, onChange }: TimeInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
      </span>
      <Input
        aria-label={ariaLabel}
        type="text"
        inputMode="numeric"
        maxLength={5}
        pattern={HHMM_PATTERN}
        placeholder="HH:mm"
        title="24-hour time, e.g. 14:53"
        className="pl-7"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function FareOptionDialog({ open, onOpenChange, initial, onSave }: FareOptionDialogProps) {
  // A newly quoted itinerary is always for a future flight. Editing an existing option is exempt,
  // so a fare quoted a while ago stays correctable (e.g. to fix its baggage notes) without being
  // forced to re-date its segments. Same create/edit split as the enquiry's own travel dates.
  const { timeZone } = useBranding();
  const minSegmentDate = initial ? undefined : agencyToday(timeZone);
  const [airlineName, setAirlineName] = useState('');
  const [airlineCode, setAirlineCode] = useState<string | undefined>(undefined);
  const [adultPrice, setAdultPrice] = useState('');
  const [childPrice, setChildPrice] = useState('');
  const [infantPrice, setInfantPrice] = useState('');
  const [baggageNotes, setBaggageNotes] = useState('');
  const [segments, setSegments] = useState<SegmentForm[]>([{ ...EMPTY_SEGMENT }]);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setAirlineName(initial.airlineName);
      setAirlineCode(initial.airlineCode);
      setAdultPrice(String(initial.prices.adult));
      setChildPrice(initial.prices.child === undefined ? '' : String(initial.prices.child));
      setInfantPrice(initial.prices.infant === undefined ? '' : String(initial.prices.infant));
      setBaggageNotes(initial.baggageNotes ?? '');
      setSegments(
        initial.segments.map((s) => ({
          from: s.from,
          to: s.to,
          date: s.date,
          departTime: s.departTime ?? '',
          arriveTime: s.arriveTime ?? '',
        }))
      );
    } else {
      setAirlineName('');
      setAirlineCode(undefined);
      setAdultPrice('');
      setChildPrice('');
      setInfantPrice('');
      setBaggageNotes('');
      setSegments([{ ...EMPTY_SEGMENT }]);
    }
  }, [open, initial]);

  function updateSegment(index: number, patch: Partial<SegmentForm>) {
    setSegments((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const option: EnquiryFareOption = {
      airlineCode,
      airlineName,
      prices: {
        adult: Number(adultPrice),
        child: optionalPrice(childPrice),
        infant: optionalPrice(infantPrice),
      },
      baggageNotes: baggageNotes || undefined,
      segments: segments.map(
        (s): EnquirySegment => ({
          from: s.from,
          to: s.to,
          date: s.date,
          departTime: s.departTime || undefined,
          arriveTime: s.arriveTime || undefined,
        })
      ),
    };
    onSave(option);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit fare option' : 'Add fare option'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-3">
            <div className="space-y-1 rounded-md border p-3">
              <Label htmlFor="fare-airline" className="flex items-center gap-1.5" required>
                <Plane className="h-3.5 w-3.5" />
                Airline
              </Label>
              <CodeSearchField
                id="fare-airline"
                ariaLabel="Airline"
                value={airlineName}
                onChange={(value) => {
                  setAirlineName(value);
                  setAirlineCode(undefined); // free-typed text has no code until a suggestion is picked
                }}
                onPick={(option) => {
                  setAirlineName(option.label);
                  setAirlineCode(option.code);
                }}
                search={searchAirlines}
                queryKey="airlines"
                placeholder="e.g. Qatar or QR"
                required
              />
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="grid grid-cols-3 gap-3">
                <FareInput id="fare-adult" label="Adult" ariaLabel="Adult fare" icon={<User className="h-3.5 w-3.5" />} value={adultPrice} onChange={setAdultPrice} required />
                <FareInput id="fare-child" label="Child" ariaLabel="Child fare" icon={<Users className="h-3.5 w-3.5" />} value={childPrice} onChange={setChildPrice} />
                <FareInput id="fare-infant" label="Infant" ariaLabel="Infant fare" icon={<Baby className="h-3.5 w-3.5" />} value={infantPrice} onChange={setInfantPrice} />
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">Segments</p>

            <div className={cn(SEGMENT_GRID, 'text-xs font-medium text-muted-foreground')}>
              <span>From<RequiredMark /></span>
              <span>To<RequiredMark /></span>
              <span>Date</span>
              <span>Depart</span>
              <span>Arrive</span>
              {/* Matches the remove Button's real footprint (size="icon" = 36px). A `sr-only` span
                  here would be position:absolute, contributing 0px to this row's trailing `auto`
                  track — the 1fr columns would absorb the difference and every label above would
                  drift right of the field it names. */}
              <span aria-hidden="true" className="w-9" />
            </div>

            {segments.map((segment, index) => (
              <div key={index} className={SEGMENT_GRID}>
                <CodeSearchField
                  ariaLabel={`Segment ${index + 1} from`}
                  value={segment.from}
                  onChange={(from) => updateSegment(index, { from })}
                  search={searchAirports}
                  queryKey="airports"
                  placeholder="e.g. IAH"
                  icon={<PlaneTakeoff className="h-4 w-4" />}
                  required
                />
                <CodeSearchField
                  ariaLabel={`Segment ${index + 1} to`}
                  value={segment.to}
                  onChange={(to) => updateSegment(index, { to })}
                  search={searchAirports}
                  queryKey="airports"
                  placeholder="e.g. LAX"
                  icon={<PlaneLanding className="h-4 w-4" />}
                  required
                />
                <DateField
                  ariaLabel={`Segment ${index + 1} date`}
                  value={segment.date}
                  onChange={(date) => updateSegment(index, { date })}
                  // Segments are flown in order, so each also floors at the one before it.
                  minDate={minSegmentDate && maxIsoDate(minSegmentDate, segments[index - 1]?.date)}
                />
                <TimeInput
                  ariaLabel={`Segment ${index + 1} depart time`}
                  value={segment.departTime}
                  onChange={(departTime) => updateSegment(index, { departTime })}
                />
                <TimeInput
                  ariaLabel={`Segment ${index + 1} arrive time`}
                  value={segment.arriveTime}
                  onChange={(arriveTime) => updateSegment(index, { arriveTime })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove segment ${index + 1}`}
                  disabled={segments.length === 1}
                  onClick={() => setSegments((rows) => rows.filter((_, i) => i !== index))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button type="button" variant="secondary" size="sm" onClick={() => setSegments((rows) => [...rows, { ...EMPTY_SEGMENT }])}>
              Add segment
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="fare-baggage" className="flex items-center gap-1.5">
              <Luggage className="h-3.5 w-3.5" />
              Baggage notes
            </Label>
            <Textarea
              id="fare-baggage"
              aria-label="Baggage notes"
              rows={2}
              value={baggageNotes}
              onChange={(e) => setBaggageNotes(e.target.value)}
              placeholder={'One line per note, e.g.\nNo check-in baggage included -  $65 per baggage.'}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save option</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
