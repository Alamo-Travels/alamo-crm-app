import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  deleteEnquiry,
  ENQUIRY_STATUSES,
  EnquiryFareOption,
  EnquiryStatus,
  getEnquiry,
  STOPS_LABELS,
  updateEnquiry,
} from '@/api/enquiries.api';
import { EnquiryDialog } from '@/components/enquiries/enquiry-dialog';
import { EnquiryStatusBadge } from '@/components/enquiries/enquiry-status-badge';
import { FareOptionDialog } from '@/components/enquiries/fare-option-dialog';
import { SendQuoteDialog } from '@/components/enquiries/send-quote-dialog';
import { AuditHistoryPanel } from '@/components/audit/audit-history-panel';
import { useAuthStore } from '@/stores/authStore';
import { canDeleteEnquiries, canEditEnquiries, canSendQuotes, canViewAudit } from '@/utils/permissions';
import { formatDisplayDate } from '@/utils/dateFormat';
import { formatPhone } from '@/utils/phoneFormat';
import { farePriceSummary, formatItinerary, formatPax, formatSegmentDates } from '@/utils/tripFormat';

export default function EnquiryDetailPage() {
  const { enquiryId } = useParams({ from: '/authed/enquiries/$enquiryId' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canSendQuote = canSendQuotes(user);
  const canDeleteEnquiry = canDeleteEnquiries(user);
  // Every control below that mutates the enquiry issues the SAME PATCH /api/enquiries/:id,
  // which is gated by `enquiries.edit` server-side — so they share one gate here rather than
  // each growing its own. Hidden, not disabled: a control that can only ever 403 is a dead end.
  const canEditEnquiry = canEditEnquiries(user);
  const canViewHistory = canViewAudit(user);

  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showSendQuote, setShowSendQuote] = useState(false);
  const [optionDialog, setOptionDialog] = useState<{ open: boolean; index: number | null }>({ open: false, index: null });

  const { data: enquiry } = useQuery({
    queryKey: ['enquiries', 'detail', enquiryId],
    queryFn: () => getEnquiry(enquiryId),
  });

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateEnquiry>[1]) => updateEnquiry(enquiryId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteEnquiry(enquiryId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      toast.success('Enquiry deleted');
      navigate({ to: '/enquiries' });
    },
  });

  if (!enquiry) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton data-testid="detail-skeleton" className="h-8 w-64" />
        <Card>
          <CardHeader>
            <Skeleton data-testid="detail-skeleton" className="h-6 w-40" />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-8 gap-y-2">
            <Skeleton data-testid="detail-skeleton" className="h-4 w-full" />
            <Skeleton data-testid="detail-skeleton" className="h-4 w-full" />
            <Skeleton data-testid="detail-skeleton" className="h-4 w-full" />
            <Skeleton data-testid="detail-skeleton" className="h-4 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton data-testid="detail-skeleton" className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton data-testid="detail-skeleton" className="h-16 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  function saveOption(option: EnquiryFareOption) {
    if (!enquiry) return;
    const fareOptions =
      optionDialog.index === null
        ? [...enquiry.fareOptions, option]
        : enquiry.fareOptions.map((existing, i) => (i === optionDialog.index ? option : existing));
    updateMutation.mutate({ fareOptions });
  }

  function removeOption(index: number) {
    if (!enquiry) return;
    updateMutation.mutate({ fareOptions: enquiry.fareOptions.filter((_, i) => i !== index) });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Enquiry — {enquiry.enquirer.name}</h2>
        <div className="flex items-center gap-2">
          {canEditEnquiry ? (
            <div className="flex items-center gap-2">
              <Label>Status</Label>
              <Select
                value={enquiry.status}
                onValueChange={(v) => updateMutation.mutate({ status: v as EnquiryStatus })}
              >
                <SelectTrigger aria-label="Status" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENQUIRY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            // Read-only fallback: the status is still worth SEEING without the ability to change
            // it — dropping it entirely would hide information a viewer legitimately needs.
            <div className="flex items-center gap-2">
              <Label>Status</Label>
              <EnquiryStatusBadge status={enquiry.status} />
            </div>
          )}
          {canEditEnquiry && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Edit"
              title="Edit"
              onClick={() => setShowEdit(true)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDeleteEnquiry && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Delete"
              title="Delete"
              className="text-destructive hover:text-destructive"
              onClick={() => setShowDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {canSendQuote && (
            <Button type="button" size="sm" disabled={enquiry.fareOptions.length === 0} onClick={() => setShowSendQuote(true)}>
              Send Quote
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <h3 className="contents">Enquiry Details</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <p>
            <span className="font-medium">Enquirer:</span> <span>{enquiry.enquirer.name}</span>
            {enquiry.enquirer.phone && ` · ${formatPhone(enquiry.enquirer.phone)}`}
            {enquiry.enquirer.email && ` · ${enquiry.enquirer.email}`}
          </p>
          <p>
            <span className="font-medium">Received:</span> {formatDisplayDate(enquiry.createdAt)}
          </p>
          <p>
            <span className="font-medium">Route:</span> {formatItinerary(enquiry.trip.segments) || '—'}
            {` (${
              enquiry.trip.tripType === 'round'
                ? 'Round trip'
                : enquiry.trip.tripType === 'multicity'
                  ? 'Multi-city'
                  : 'One-way'
            })`}
          </p>
          <p>
            <span className="font-medium">Dates:</span> {formatSegmentDates(enquiry.trip.segments) || '—'}
            {enquiry.trip.dateFlexibility && (
              <span className="text-muted-foreground"> ({enquiry.trip.dateFlexibility})</span>
            )}
          </p>
          <p>
            <span className="font-medium">Passengers:</span> {formatPax(enquiry.trip.pax) || '—'}
          </p>
          {enquiry.trip.budgetPerPax !== undefined && (
            <p>
              <span className="font-medium">Budget/pax:</span> ${enquiry.trip.budgetPerPax.toFixed(2)}
            </p>
          )}
          {enquiry.trip.cabins.length > 0 && (
            <p>
              <span className="font-medium">Cabin:</span> {enquiry.trip.cabins.join(', ')}
            </p>
          )}
          {enquiry.trip.preferredAirlines.length > 0 && (
            <p>
              <span className="font-medium">Preferred airlines:</span> {enquiry.trip.preferredAirlines.join(', ')}
            </p>
          )}
          {enquiry.trip.stops && (
            <p>
              <span className="font-medium">Stops:</span> {STOPS_LABELS[enquiry.trip.stops]}
            </p>
          )}
          <p>
            <span className="font-medium">Quote sent:</span>{' '}
            {enquiry.quoteSentAt ? formatDisplayDate(enquiry.quoteSentAt) : '—'}
          </p>
          {enquiry.notes && (
            <p className="col-span-2">
              <span className="font-medium">Notes:</span> {enquiry.notes}
            </p>
          )}
          <div>
            <EnquiryStatusBadge status={enquiry.status} />
          </div>
        </CardContent>
      </Card>

      {canViewHistory && (
        <Card>
          <CardContent className="pt-6">
            <AuditHistoryPanel filter={{ targetCollection: 'enquiries', targetId: enquiryId }} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <h3 className="contents">Fare Options</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {enquiry.fareOptions.length === 0 && (
            <p className="text-sm text-muted-foreground">No fare options yet — add the fares you found.</p>
          )}
          {enquiry.fareOptions.map((option, index) => (
            <div key={index} className="rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">
                  Option {index + 1}: {option.airlineName}
                  {option.airlineCode && ` (${option.airlineCode})`} — {farePriceSummary(option)}
                </p>
                {canEditEnquiry && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Edit option ${index + 1}`}
                      title="Edit"
                      onClick={() => setOptionDialog({ open: true, index })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Remove option ${index + 1}`}
                      title="Remove"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeOption(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-2 space-y-1 text-muted-foreground">
                {option.segments.map((segment, i) => (
                  <p key={i}>
                    {segment.from} to {segment.to} — {formatDisplayDate(segment.date)}
                    {segment.departTime && ` · Depart ${segment.departTime}`}
                    {segment.arriveTime && ` · Arrive ${segment.arriveTime}`}
                  </p>
                ))}
                {option.baggageNotes &&
                  option.baggageNotes.split('\n').map((line, i) => <p key={`b${i}`}>{line}</p>)}
              </div>
            </div>
          ))}
          {canEditEnquiry && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setOptionDialog({ open: true, index: null })}>
              Add fare option
            </Button>
          )}
        </CardContent>
      </Card>

      <EnquiryDialog open={showEdit} onOpenChange={setShowEdit} enquiry={enquiry} />
      <FareOptionDialog
        open={optionDialog.open}
        onOpenChange={(open) => setOptionDialog((s) => ({ ...s, open }))}
        initial={optionDialog.index !== null ? enquiry.fareOptions[optionDialog.index] : null}
        onSave={saveOption}
      />
      {canSendQuote && <SendQuoteDialog open={showSendQuote} onOpenChange={setShowSendQuote} enquiry={enquiry} />}

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this enquiry?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This permanently removes the enquiry and its fare options.</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowDelete(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => deleteMutation.mutate()}>
              Delete enquiry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
