import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlaneLanding, PlaneTakeoff, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { CodeSearchField } from '@/components/code-search-field';
import { DateField } from '@/components/date-field';
import { DraftRestoreBar } from '@/components/draft-restore-bar';
import { LeaveFormDialog } from '@/components/leave-form-dialog';
import { MultiCodeSearchField } from '@/components/multi-code-search-field';
import { PhoneInput } from '@/components/phone-input';
import { CabinSelectField } from '@/components/enquiries/cabin-select-field';
import { PassengerCountField, PassengerCounts } from '@/components/enquiries/passenger-count-field';
import { searchAirlines, searchAirports } from '@/api/flightData.api';
import { useBranding } from '@/hooks/useBranding';
import { useFormDraft } from '@/hooks/useFormDraft';
import { agencyToday } from '@/utils/agencyTime';
import { maxIsoDate } from '@/utils/dateFormat';
import { isGroupBookingSize } from '@/utils/tripFormat';
import {
  CabinClass,
  createEnquiry,
  CruiseDestination,
  CRUISE_DESTINATIONS,
  Enquiry,
  ENQUIRY_KINDS,
  enquiryKind,
  EnquiryKind,
  EnquiryTripSegment,
  KIND_LABELS,
  STOPS_LABELS,
  TRIP_STOPS,
  TRIP_TYPES,
  TripStops,
  TripType,
  updateEnquiry,
} from '@/api/enquiries.api';

interface EnquiryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this enquiry instead of creating a new one. */
  enquiry?: Enquiry | null;
}

const emptySegment: EnquiryTripSegment = { from: '', to: '', date: '' };

/**
 * A trip segment as held in form state. `touched` (leg-2 only, in round-trip mode) means
 * "the row currently at this position has been hand-edited" — it lives ON the row object
 * itself so its lifetime is automatically tied to the row's: a brand-new row (from resize(),
 * addSegment(), or a fresh mirror) is a brand-new object literal with no `touched` key, and a
 * removed row's flag is discarded along with the row when it's filtered out. There is no
 * separate boolean to fall out of sync with "which row currently occupies slot 1".
 */
type FormSegment = EnquiryTripSegment & { touched?: boolean };

interface EnquiryFormState {
  name: string;
  phone: string;
  email: string;
  // Flight / Tour / Cruise (2026-08-08). Flight is the default so an untouched dialog behaves
  // exactly as it did before this field existed.
  kind: EnquiryKind;
  tripType: TripType;
  segments: FormSegment[];
  dateFlexibility: string;
  pax: PassengerCounts;
  budgetPerPax: string;
  cabins: CabinClass[];
  preferredAirlines: string[];
  // Radix SelectItem forbids an empty-string value, so "no preference" needs a sentinel.
  stops: TripStops | 'any';
  notes: string;
  // Tour detail (kind === 'tour'). `tourRef` is a WordPress post id staff cannot pick — never
  // rendered as an input, only round-tripped: an edit of a website-originated tour enquiry must
  // carry it through unchanged or PATCH's wholesale replace of `tour` severs the link (see
  // handleKindChange and the payload builder below).
  tourRef?: number;
  tourName: string;
  tourDestination: string;
  tourPreferredMonth: string;
  // Cruise detail (kind === 'cruise'). '' means "not yet chosen", same sentinel-free pattern as
  // the Stops select below minus the sentinel — a cruise destination has no "no preference" option.
  cruiseDestination: CruiseDestination | '';
  cruiseLine: string;
  cruiseShip: string;
  cruiseWhen: string;
  cruiseIsGroup: boolean;
}

const emptyForm: EnquiryFormState = {
  name: '',
  phone: '',
  email: '',
  kind: 'flight',
  tripType: 'round',
  segments: [{ ...emptySegment }, { ...emptySegment }],
  dateFlexibility: '',
  pax: { adults: 1, children: 0, infants: 0 },
  budgetPerPax: '',
  cabins: [],
  preferredAirlines: [],
  stops: 'any',
  notes: '',
  tourRef: undefined,
  tourName: '',
  tourDestination: '',
  tourPreferredMonth: '',
  cruiseDestination: '',
  cruiseLine: '',
  cruiseShip: '',
  cruiseWhen: '',
  cruiseIsGroup: false,
};

/** Every field in `emptyForm` that has a meaningful default (round trip, one adult, no stops
 * preference, two blank legs, kind flight) must read as UNTOUCHED here, or opening the dialog and
 * closing it would leave a draft behind. `segments` is checked on from/to/date only — a leg's
 * `touched` mirroring flag can be `true` on an otherwise-blank row (hand-edited then cleared
 * again), but that flag has no visible effect on an empty row, so it must not count as content
 * either. `tourRef` is skipped deliberately: drafts are create-only (see useFormDraft's `enabled`
 * below), so it can never be populated while this predicate runs. */
function isEnquiryDraftEmpty(state: EnquiryFormState): boolean {
  return (
    !state.name &&
    !state.phone &&
    !state.email &&
    !state.dateFlexibility &&
    !state.budgetPerPax &&
    !state.notes &&
    state.kind === 'flight' &&
    state.tripType === 'round' &&
    state.cabins.length === 0 &&
    state.preferredAirlines.length === 0 &&
    state.stops === 'any' &&
    state.pax.adults === 1 &&
    state.pax.children === 0 &&
    state.pax.infants === 0 &&
    state.segments.every((segment) => !segment.from && !segment.to && !segment.date) &&
    !state.tourName &&
    !state.tourDestination &&
    !state.tourPreferredMonth &&
    !state.cruiseDestination &&
    !state.cruiseLine &&
    !state.cruiseShip &&
    !state.cruiseWhen &&
    !state.cruiseIsGroup
  );
}

const TRIP_TYPE_LABELS: Record<TripType, string> = {
  oneway: 'One-way',
  round: 'Round trip',
  multicity: 'Multi-city',
};

/** The reverse of a leg, used to prefill a round trip's return. Deliberately returns a plain
 * `EnquiryTripSegment` (no `touched` key) — a mirrored row has never been hand-edited. */
function mirror(segment: EnquiryTripSegment): EnquiryTripSegment {
  return { from: segment.to ?? '', to: segment.from ?? '', date: '' };
}

/** Reshape the rows to fit a newly chosen trip type, preserving what's already typed (and,
 * for any row that's carried over unchanged, its `touched` flag along with it). */
function resize(segments: FormSegment[], tripType: TripType): FormSegment[] {
  if (tripType === 'oneway') return segments.slice(0, 1);
  if (tripType === 'round') {
    const [outbound = { ...emptySegment }, inbound] = segments;
    return [outbound, inbound ?? mirror(outbound)];
  }
  return segments.length > 0 ? segments : [{ ...emptySegment }];
}

export function EnquiryDialog({ open, onOpenChange, enquiry }: EnquiryDialogProps) {
  const [form, setForm] = useState<EnquiryFormState>(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = Boolean(enquiry);
  // Nobody enquires about a flight that has already left, so a NEW enquiry's travel dates floor at
  // the agency's today. An EDIT is exempt — a stale enquiry raised weeks ago must stay correctable
  // (say, to fix a typo'd airport) without being forced to re-date the trip. Same create/edit split
  // as the booking form's trip dates.
  const { timeZone } = useBranding();
  const minTravelDate = isEdit ? undefined : agencyToday(timeZone);

  const [leaveOpen, setLeaveOpen] = useState(false);
  // `open` is part of `enabled` because this dialog never unmounts (an `open` prop, not a
  // remount) — see useFormDraft's closed -> open re-read. Drafts are create-only: an abandoned
  // edit loses nothing since the record on file is intact.
  const draft = useFormDraft<EnquiryFormState>('enquiry', form, isEnquiryDraftEmpty, open && !isEdit);

  function handleRestoreDraft() {
    const restored = draft.restore();
    if (restored) setForm(restored);
  }

  function handleCancelClick() {
    if (draft.hasContent) {
      setLeaveOpen(true);
      return;
    }
    onOpenChange(false);
  }

  useEffect(() => {
    if (!open) return;
    if (enquiry) {
      setForm({
        name: enquiry.enquirer.name,
        phone: enquiry.enquirer.phone ?? '',
        email: enquiry.enquirer.email ?? '',
        kind: enquiryKind(enquiry),
        tripType: enquiry.trip.tripType,
        // Every row that genuinely came back from the API is marked touched: a saved itinerary
        // must never be re-mirrored over. This is applied BEFORE resize() so that any row
        // resize() has to synthesize (e.g. a legacy enquiry saved with tripType: 'round' but
        // segments: [], which shipped before there was a data migration) is a brand-new object
        // literal with no `touched` key — and therefore remains mirrorable — rather than
        // inheriting `touched: true` from a blanket post-resize pass.
        segments: resize(
          enquiry.trip.segments.length
            ? enquiry.trip.segments.map((s) => ({
                from: s.from ?? '',
                to: s.to ?? '',
                date: s.date ?? '',
                touched: true,
              }))
            : [{ ...emptySegment }],
          enquiry.trip.tripType
        ),
        dateFlexibility: enquiry.trip.dateFlexibility ?? '',
        pax: { ...enquiry.trip.pax },
        budgetPerPax: enquiry.trip.budgetPerPax !== undefined ? String(enquiry.trip.budgetPerPax) : '',
        cabins: [...enquiry.trip.cabins],
        preferredAirlines: [...enquiry.trip.preferredAirlines],
        stops: enquiry.trip.stops ?? 'any',
        notes: enquiry.notes ?? '',
        // Round-tripped, never shown — see the field comment on EnquiryFormState.tourRef.
        tourRef: enquiry.tour?.tourRef,
        tourName: enquiry.tour?.tourName ?? '',
        tourDestination: enquiry.tour?.destination ?? '',
        tourPreferredMonth: enquiry.tour?.preferredMonth ?? '',
        // `EnquiryCruise.destination` is a bare `string` on the read side (see its comment in
        // enquiries.api.ts); cast into the write-side union is safe because the API only ever
        // stores one of CRUISE_DESTINATIONS on this field.
        cruiseDestination: (enquiry.cruise?.destination as CruiseDestination | undefined) ?? '',
        cruiseLine: enquiry.cruise?.line ?? '',
        cruiseShip: enquiry.cruise?.ship ?? '',
        cruiseWhen: enquiry.cruise?.when ?? '',
        cruiseIsGroup: enquiry.cruise?.isGroup ?? false,
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, enquiry]);

  /** Switching kind clears the OTHER kind's field values in form state (not just hides them), so
   * the payload matches §2.2 (one kind's sub-document, never two) by construction rather than
   * relying on the server to clean up after it. `tourRef` is cleared here too — once staff pick a
   * different kind, the stored WordPress link no longer describes what's being asked for. */
  function handleKindChange(kind: EnquiryKind) {
    setForm((prev) => ({
      ...prev,
      kind,
      /*
       * `tourRef` is deliberately PRESERVED across a kind switch, unlike every visible tour
       * field beside it. It is a WordPress post id the user cannot see, cannot retype, and did
       * not choose — so clearing it on a Tour → Flight → Tour toggle silently severed a
       * website-originated enquiry's link to the tour actually enquired about, with nothing on
       * screen to show it had gone.
       *
       * Keeping it cannot leak it onto a different enquiry: this is per-dialog state, and the
       * `[open, enquiry]` effect re-seeds the whole form from the record whenever the dialog
       * opens or the enquiry changes. Nor can it be sent under the wrong kind — the payload
       * only includes `tour` at all when `kind === 'tour'`.
       */
      tourName: kind === 'tour' ? prev.tourName : '',
      tourDestination: kind === 'tour' ? prev.tourDestination : '',
      tourPreferredMonth: kind === 'tour' ? prev.tourPreferredMonth : '',
      cruiseDestination: kind === 'cruise' ? prev.cruiseDestination : '',
      cruiseLine: kind === 'cruise' ? prev.cruiseLine : '',
      cruiseShip: kind === 'cruise' ? prev.cruiseShip : '',
      cruiseWhen: kind === 'cruise' ? prev.cruiseWhen : '',
      /*
       * Re-derived on the way IN to cruise rather than carried, because the auto-tick otherwise
       * only fires on a pax change: a Cruise → Tour → Cruise toggle left a 50-passenger party
       * unflagged, which is exactly the enquiry the flag exists for. Still never auto-UNticks —
       * a staff member who ticked it for a party whose head count they do not yet know keeps it.
       */
      cruiseIsGroup: kind === 'cruise' ? prev.cruiseIsGroup || isGroupBookingSize(prev.pax) : false,
    }));
  }

  function updateSegment(index: number, patch: Partial<EnquiryTripSegment>) {
    setForm((prev) => {
      const segments = prev.segments.map((s, i) => (i === index ? { ...s, ...patch } : s));
      const editingRoute = patch.from !== undefined || patch.to !== undefined;
      if (prev.tripType === 'round' && index === 0 && editingRoute && !segments[1]?.touched) {
        segments[1] = { ...mirror(segments[0]), date: segments[1]?.date ?? '' };
      }
      return { ...prev, segments };
    });
  }

  /** Leg 2's route edited by hand — marks THIS row touched, pinning it against further
   * mirroring for as long as it remains in slot 1. */
  function updateReturnRoute(patch: Partial<EnquiryTripSegment>) {
    setForm((prev) => ({
      ...prev,
      segments: prev.segments.map((s, i) => (i === 1 ? { ...s, ...patch, touched: true } : s)),
    }));
  }

  function handleTripTypeChange(tripType: TripType) {
    setForm((prev) => ({ ...prev, tripType, segments: resize(prev.segments, tripType) }));
  }

  function addSegment() {
    setForm((prev) => ({ ...prev, segments: [...prev.segments, { ...emptySegment }] }));
  }

  function removeSegment(index: number) {
    setForm((prev) => ({ ...prev, segments: prev.segments.filter((_, i) => i !== index) }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        enquirer: { name: form.name, phone: form.phone || undefined, email: form.email || undefined },
        kind: form.kind,
        trip: {
          tripType: form.tripType,
          // `touched` is form-only bookkeeping (see FormSegment) — never sent to the API.
          segments: form.segments.map((s) => ({ from: s.from, to: s.to, date: s.date })),
          dateFlexibility: form.dateFlexibility || undefined,
          pax: { ...form.pax },
          budgetPerPax: form.budgetPerPax ? Number(form.budgetPerPax) : undefined,
          cabins: form.cabins,
          preferredAirlines: form.preferredAirlines,
          stops: form.stops === 'any' ? undefined : form.stops,
        },
        // Only the sub-document matching `kind` is ever sent — see handleKindChange, which keeps
        // the OTHER kind's fields cleared in form state so this falls out by construction rather
        // than needing its own bespoke stripping logic here.
        ...(form.kind === 'tour' && {
          tour: {
            tourRef: form.tourRef,
            tourName: form.tourName || undefined,
            destination: form.tourDestination || undefined,
            preferredMonth: form.tourPreferredMonth || undefined,
          },
        }),
        ...(form.kind === 'cruise' && {
          cruise: {
            destination: form.cruiseDestination || undefined,
            line: form.cruiseLine || undefined,
            ship: form.cruiseShip || undefined,
            when: form.cruiseWhen || undefined,
            isGroup: form.cruiseIsGroup,
          },
        }),
        notes: form.notes || undefined,
      };
      return enquiry ? updateEnquiry(enquiry.id, payload) : createEnquiry(payload);
    },
    onSuccess: () => {
      draft.discard();
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      onOpenChange(false);
      toast.success(enquiry ? 'Enquiry updated' : 'Enquiry created');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const isMulticity = form.tripType === 'multicity';
  const canRemoveSegments = isMulticity && form.segments.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit enquiry' : 'New enquiry'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {draft.pending && (
            <DraftRestoreBar
              savedAt={draft.pending.savedAt}
              onRestore={handleRestoreDraft}
              onDiscard={draft.discard}
            />
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="enquiry-name" required>Enquirer name</Label>
              <Input
                id="enquiry-name"
                aria-label="Enquirer name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="enquiry-phone">Phone</Label>
              <PhoneInput
                id="enquiry-phone"
                aria-label="Phone"
                value={form.phone}
                onChange={(phone) => setForm({ ...form, phone })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="enquiry-email">Email</Label>
              <Input
                id="enquiry-email"
                aria-label="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Kind</Label>
            <RadioGroup
              aria-label="Kind"
              value={form.kind}
              onValueChange={(v) => handleKindChange(v as EnquiryKind)}
              className="flex flex-wrap gap-6 pt-1"
            >
              {ENQUIRY_KINDS.map((kind) => (
                <div key={kind} className="flex items-center gap-2">
                  <RadioGroupItem id={`enquiry-kind-${kind}`} value={kind} />
                  <Label htmlFor={`enquiry-kind-${kind}`} className="cursor-pointer font-normal">
                    {KIND_LABELS[kind]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {form.kind === 'flight' && (
            <>
              <div className="space-y-1">
                <Label>Trip type</Label>
                <RadioGroup
                  aria-label="Trip type"
                  value={form.tripType}
                  onValueChange={(v) => handleTripTypeChange(v as TripType)}
                  className="flex flex-wrap gap-6 pt-1"
                >
                  {TRIP_TYPES.map((tripType) => (
                    <div key={tripType} className="flex items-center gap-2">
                      <RadioGroupItem id={`enquiry-triptype-${tripType}`} value={tripType} />
                      <Label htmlFor={`enquiry-triptype-${tripType}`} className="cursor-pointer font-normal">
                        {TRIP_TYPE_LABELS[tripType]}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="space-y-2">
                {form.segments.map((segment, index) => (
              <div key={index} className="flex items-end gap-3">
                {/* From/To carry airport names and get the width; a date is a fixed-width value. */}
                <div className="grid flex-1 grid-cols-[2fr_2fr_1.25fr] gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`enquiry-from-${index}`}>From</Label>
                    <CodeSearchField
                      id={`enquiry-from-${index}`}
                      // The visible label is unnumbered, but each row's accessible name still
                      // carries its index so screen readers (and tests) can tell the legs apart.
                      ariaLabel={`From ${index + 1}`}
                      value={segment.from ?? ''}
                      onChange={(from) =>
                        form.tripType === 'round' && index === 1
                          ? updateReturnRoute({ from })
                          : updateSegment(index, { from })
                      }
                      search={searchAirports}
                      queryKey="airports"
                      placeholder="Origin"
                      icon={<PlaneTakeoff className="size-4" />}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`enquiry-to-${index}`}>To</Label>
                    <CodeSearchField
                      id={`enquiry-to-${index}`}
                      ariaLabel={`To ${index + 1}`}
                      value={segment.to ?? ''}
                      onChange={(to) =>
                        form.tripType === 'round' && index === 1
                          ? updateReturnRoute({ to })
                          : updateSegment(index, { to })
                      }
                      search={searchAirports}
                      queryKey="airports"
                      placeholder="Destination"
                      icon={<PlaneLanding className="size-4" />}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`enquiry-date-${index}`}>Date</Label>
                    <DateField
                      id={`enquiry-date-${index}`}
                      ariaLabel={`Date ${index + 1}`}
                      value={segment.date ?? ''}
                      onChange={(date) => updateSegment(index, { date })}
                      // Legs are flown in order, so each one also floors at the leg before it —
                      // a return can't precede its outbound. Same-day is allowed (a >= compare).
                      minDate={minTravelDate && maxIsoDate(minTravelDate, form.segments[index - 1]?.date)}
                    />
                  </div>
                </div>
                {canRemoveSegments && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove flight ${index + 1}`}
                    onClick={() => removeSegment(index)}
                    className="text-destructive"
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {isMulticity && (
              <Button type="button" variant="secondary" size="sm" onClick={addSegment}>
                <Plus className="mr-1 size-4" />
                Add flight
              </Button>
            )}
              </div>
            </>
          )}

          {form.kind === 'tour' && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="enquiry-tour-name">Tour name</Label>
                <Input
                  id="enquiry-tour-name"
                  aria-label="Tour name"
                  value={form.tourName}
                  onChange={(e) => setForm({ ...form, tourName: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="enquiry-tour-destination">Destination</Label>
                <Input
                  id="enquiry-tour-destination"
                  aria-label="Tour destination"
                  value={form.tourDestination}
                  onChange={(e) => setForm({ ...form, tourDestination: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="enquiry-tour-month">Preferred month</Label>
                <Input
                  id="enquiry-tour-month"
                  aria-label="Preferred month"
                  value={form.tourPreferredMonth}
                  onChange={(e) => setForm({ ...form, tourPreferredMonth: e.target.value })}
                  placeholder="e.g. December"
                />
              </div>
            </div>
          )}

          {form.kind === 'cruise' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="enquiry-cruise-destination">Destination</Label>
                  <Select
                    value={form.cruiseDestination}
                    onValueChange={(v) => setForm({ ...form, cruiseDestination: v as CruiseDestination })}
                  >
                    <SelectTrigger id="enquiry-cruise-destination" aria-label="Cruise destination" className="w-full">
                      <SelectValue placeholder="Select a destination" />
                    </SelectTrigger>
                    <SelectContent>
                      {CRUISE_DESTINATIONS.map((destination) => (
                        <SelectItem key={destination} value={destination}>
                          {destination}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="enquiry-cruise-line">Cruise line</Label>
                  <Input
                    id="enquiry-cruise-line"
                    aria-label="Cruise line"
                    value={form.cruiseLine}
                    onChange={(e) => setForm({ ...form, cruiseLine: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="enquiry-cruise-ship">Ship</Label>
                  <Input
                    id="enquiry-cruise-ship"
                    aria-label="Ship"
                    value={form.cruiseShip}
                    onChange={(e) => setForm({ ...form, cruiseShip: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 items-end gap-3">
                <div className="col-span-2 space-y-1">
                  <Label htmlFor="enquiry-cruise-when">When</Label>
                  <Input
                    id="enquiry-cruise-when"
                    aria-label="When"
                    value={form.cruiseWhen}
                    onChange={(e) => setForm({ ...form, cruiseWhen: e.target.value })}
                    placeholder="e.g. flexible, next spring"
                  />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Checkbox
                    id="enquiry-cruise-group"
                    aria-label="Group booking (50+ passengers)"
                    checked={form.cruiseIsGroup}
                    onCheckedChange={(checked) => setForm({ ...form, cruiseIsGroup: checked === true })}
                  />
                  <Label htmlFor="enquiry-cruise-group" className="cursor-pointer font-normal">
                    Group booking (50+ passengers)
                  </Label>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 items-start gap-3">
            <div className="space-y-1">
              <Label>Passengers</Label>
              <PassengerCountField
                value={form.pax}
                onChange={(pax) =>
                  setForm((prev) => ({
                    ...prev,
                    pax,
                    // Auto-ticks Group booking once the party reaches the website's own threshold
                    // (isGroupBookingSize) — but never auto-UNticks, so a staff member who
                    // deliberately clears it stays cleared even if pax changes again. Runs
                    // regardless of the currently selected kind: entering a large party while on
                    // Flight/Tour and only THEN switching to Cruise must not lose the auto-tick.
                    cruiseIsGroup: prev.cruiseIsGroup || isGroupBookingSize(pax),
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="enquiry-airlines">Preferred airlines</Label>
              <MultiCodeSearchField
                id="enquiry-airlines"
                ariaLabel="Preferred airlines"
                value={form.preferredAirlines}
                onChange={(preferredAirlines) => setForm({ ...form, preferredAirlines })}
                search={searchAirlines}
                queryKey="airlines"
                placeholder="Any airline"
              />
            </div>
            <div className="space-y-1">
              <Label>Cabin</Label>
              <CabinSelectField
                value={form.cabins}
                onChange={(cabins: CabinClass[]) => setForm({ ...form, cabins })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Stops</Label>
              <Select
                value={form.stops}
                onValueChange={(v) => setForm({ ...form, stops: v as TripStops | 'any' })}
              >
                <SelectTrigger aria-label="Stops" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {TRIP_STOPS.map((stop) => (
                    <SelectItem key={stop} value={stop}>
                      {STOPS_LABELS[stop]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="enquiry-flexibility">Date flexibility</Label>
              <Input
                id="enquiry-flexibility"
                aria-label="Date flexibility"
                value={form.dateFlexibility}
                onChange={(e) => setForm({ ...form, dateFlexibility: e.target.value })}
                placeholder="e.g. ±3 days"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="enquiry-budget">Budget per passenger</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="enquiry-budget"
                  aria-label="Budget per passenger"
                  type="number"
                  min={0}
                  step="0.01"
                  className="pl-6"
                  value={form.budgetPerPax}
                  onChange={(e) => setForm({ ...form, budgetPerPax: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="enquiry-notes">Notes</Label>
            <Textarea
              id="enquiry-notes"
              aria-label="Notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {mutation.isError && (
            <p className="text-sm text-destructive">Save failed. Check your connection and try again.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancelClick}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? 'Saving…' : 'Save enquiry'}
            </Button>
          </DialogFooter>
        </form>
        <LeaveFormDialog
          open={leaveOpen}
          onOpenChange={setLeaveOpen}
          title="Leave this enquiry?"
          onDiscard={() => {
            draft.discard();
            setLeaveOpen(false);
            onOpenChange(false);
          }}
          onKeep={() => {
            draft.keep();
            setLeaveOpen(false);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
