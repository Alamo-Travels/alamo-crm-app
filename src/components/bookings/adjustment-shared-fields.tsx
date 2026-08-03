import { Plane, PlaneLanding, PlaneTakeoff, StickyNote, Ticket } from 'lucide-react';
import { DateField } from '@/components/date-field';
import { IconInput } from '@/components/icon-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { maxIsoDate } from '@/utils/dateFormat';

export interface AdjustmentSharedValue {
  bookingDate: string;
  pnr: string;
  airlineCode: string;
  depCity: string;
  arrCity: string;
  depDate: string;
  arrDate: string;
  remark: string;
  paymentStatus: 'paid' | 'pending';
  paymentType: 'card' | 'check' | 'cash';
  pendingAmount: string;
}

interface AdjustmentSharedFieldsProps {
  bookingType: 'Reissue' | 'Refund';
  value: AdjustmentSharedValue;
  onChange: (patch: Partial<AdjustmentSharedValue>) => void;
  /** Earliest selectable Departure/Arrival date, 'YYYY-MM-DD'. Passed by the CREATE flow only
   * (a reissue is a new, future flight); the edit dialog omits it so a historic adjustment stays
   * editable. Does not apply to the adjustment's own booking date, which is legitimately back-dated. */
  minTripDate?: string;
}

/** The fields shared by both create (`AdjustmentBookingForm`) and edit (`EditAdjustmentDialog`)
 * flows for a Reissue/Refund adjustment: booking date, PNR, airline code, the Reissue-only
 * city/date inputs, a remark, and the payment status/type/pending-amount block. Extracted
 * verbatim out of `adjustment-booking-form.tsx` — every `aria-label` here is queried by existing
 * tests, so none of them may change. */
export function AdjustmentSharedFields({ bookingType, value, onChange, minTripDate }: AdjustmentSharedFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="adjustment-booking-date" required>Adjustment booking date</Label>
        <DateField
          id="adjustment-booking-date"
          ariaLabel="Adjustment booking date"
          value={value.bookingDate}
          onChange={(bookingDate) => onChange({ bookingDate })}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="adjustment-pnr" required>PNR</Label>
        <IconInput
          id="adjustment-pnr"
          aria-label="Adjustment PNR"
          icon={<Ticket />}
          value={value.pnr}
          onChange={(e) => onChange({ pnr: e.target.value })}
          placeholder="PNR — e.g. X4F2QP"
          required
        />
      </div>
      <IconInput
        aria-label="Adjustment airline code"
        icon={<Plane />}
        value={value.airlineCode}
        onChange={(e) => onChange({ airlineCode: e.target.value })}
        placeholder="Airline code (optional) — e.g. QR"
      />
      {bookingType === 'Reissue' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="adjustment-dep-city" required>Departure city</Label>
            <IconInput
              id="adjustment-dep-city"
              aria-label="Adjustment departure city"
              icon={<PlaneTakeoff />}
              value={value.depCity}
              onChange={(e) => onChange({ depCity: e.target.value })}
              placeholder="Departure city — e.g. IAH"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-arr-city" required>Arrival city</Label>
            <IconInput
              id="adjustment-arr-city"
              aria-label="Adjustment arrival city"
              icon={<PlaneLanding />}
              value={value.arrCity}
              onChange={(e) => onChange({ arrCity: e.target.value })}
              placeholder="Arrival city — e.g. COK"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-dep-date">Departure date</Label>
            <DateField
              id="adjustment-dep-date"
              ariaLabel="Adjustment departure date"
              value={value.depDate}
              onChange={(depDate) => onChange({ depDate })}
              minDate={minTripDate}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-arr-date">Arrival date</Label>
            <DateField
              id="adjustment-arr-date"
              ariaLabel="Adjustment arrival date"
              value={value.arrDate}
              onChange={(arrDate) => onChange({ arrDate })}
              // Arrival additionally can't precede its own departure. Both bounds vanish when the
              // edit flow omits `minTripDate`, so a historic adjustment stays correctable.
              minDate={minTripDate && maxIsoDate(minTripDate, value.depDate)}
            />
          </div>
        </>
      )}
      <div className="space-y-2">
        <Label htmlFor="adjustment-remark">Remark</Label>
        <IconInput
          id="adjustment-remark"
          aria-label="Adjustment remark"
          icon={<StickyNote />}
          value={value.remark}
          onChange={(e) => onChange({ remark: e.target.value })}
          placeholder="Optional note"
        />
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Label>Payment status</Label>
          <Select
            value={value.paymentStatus}
            onValueChange={(v) => onChange({ paymentStatus: v as 'paid' | 'pending' })}
          >
            <SelectTrigger aria-label="Adjustment payment status" className="w-32">
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
          <Select
            value={value.paymentType}
            onValueChange={(v) => onChange({ paymentType: v as 'card' | 'check' | 'cash' })}
          >
            <SelectTrigger aria-label="Adjustment payment type" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="card">Card</SelectItem>
              <SelectItem value="check">Check</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {value.paymentStatus === 'pending' && (
        <div className="space-y-2">
          <Label htmlFor="adjustment-amount-owed" required>Amount owed</Label>
          <Input
            id="adjustment-amount-owed"
            aria-label="Adjustment amount owed"
            type="number"
            value={value.pendingAmount}
            onChange={(e) => onChange({ pendingAmount: e.target.value })}
            placeholder="Amount owed"
            required
          />
        </div>
      )}
    </>
  );
}
