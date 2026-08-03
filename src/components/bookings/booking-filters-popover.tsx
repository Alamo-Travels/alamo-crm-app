import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { DateField } from '@/components/date-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { DateRangeOperator, DateRangeParam } from '@/api/bookings.api';

export interface BookingCustomFilters {
  airlineCode?: string;
  depDate?: DateRangeParam;
  arrDate?: DateRangeParam;
}

const EMPTY_RANGE: DateRangeParam = { operator: 'before', from: '', to: '' };

function isRangeComplete(range: DateRangeParam): boolean {
  if (range.operator === 'between') return Boolean(range.from) && Boolean(range.to);
  return Boolean(range.from);
}

function countActive(filters: BookingCustomFilters): number {
  let count = 0;
  if (filters.airlineCode?.trim()) count += 1;
  if (filters.depDate && isRangeComplete(filters.depDate)) count += 1;
  if (filters.arrDate && isRangeComplete(filters.arrDate)) count += 1;
  return count;
}

function DateRangeFields({
  label,
  ariaPrefix,
  range,
  onChange,
}: {
  label: string;
  ariaPrefix: string;
  range: DateRangeParam;
  onChange: (range: DateRangeParam) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={range.operator}
          onValueChange={(v) => onChange({ ...range, operator: v as DateRangeOperator })}
        >
          <SelectTrigger aria-label={`${ariaPrefix} operator`} className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="before">Before</SelectItem>
            <SelectItem value="after">After</SelectItem>
            <SelectItem value="between">Between</SelectItem>
          </SelectContent>
        </Select>
        <DateField
          ariaLabel={range.operator === 'between' ? `${ariaPrefix} from` : `${ariaPrefix} value`}
          value={range.from ?? ''}
          onChange={(from) => onChange({ ...range, from })}
          className="w-[150px]"
        />
        {range.operator === 'between' && (
          <DateField
            ariaLabel={`${ariaPrefix} to`}
            value={range.to ?? ''}
            onChange={(to) => onChange({ ...range, to })}
            className="w-[150px]"
          />
        )}
      </div>
    </div>
  );
}

interface BookingFiltersPopoverProps {
  value: BookingCustomFilters;
  onApply: (filters: BookingCustomFilters) => void;
}

export function BookingFiltersPopover({ value, onApply }: BookingFiltersPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BookingCustomFilters>(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const activeCount = countActive(value);

  function handleApply() {
    const cleaned: BookingCustomFilters = {
      airlineCode: draft.airlineCode?.trim() || undefined,
      depDate: draft.depDate && isRangeComplete(draft.depDate) ? draft.depDate : undefined,
      arrDate: draft.arrDate && isRangeComplete(draft.arrDate) ? draft.arrDate : undefined,
    };
    onApply(cleaned);
    setOpen(false);
  }

  function handleClear() {
    setDraft({});
    onApply({});
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {activeCount}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] space-y-4" align="start">
        <div className="space-y-2">
          <Label htmlFor="booking-filter-airline">Airline</Label>
          <Input
            id="booking-filter-airline"
            placeholder="e.g. QR"
            value={draft.airlineCode ?? ''}
            onChange={(e) => setDraft({ ...draft, airlineCode: e.target.value })}
          />
        </div>
        <DateRangeFields
          label="Departure Date"
          ariaPrefix="Departure date filter"
          range={draft.depDate ?? EMPTY_RANGE}
          onChange={(depDate) => setDraft({ ...draft, depDate })}
        />
        <DateRangeFields
          label="Arrival Date"
          ariaPrefix="Arrival date filter"
          range={draft.arrDate ?? EMPTY_RANGE}
          onChange={(arrDate) => setDraft({ ...draft, arrDate })}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={handleClear}>
            Clear
          </Button>
          <Button type="button" size="sm" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
