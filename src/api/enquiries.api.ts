import { apiClient } from './client';

export const ENQUIRY_STATUSES = ['New', 'Quoted', 'Booked', 'Closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

// The public quote form became three conditional forms — Flight/Tour/Cruise (2026-08-08). The
// API always returns `kind` (it defaults to 'flight' server-side, including on every document
// created before this field existed), but `kind` is kept OPTIONAL on this frontend type on
// purpose: a required field would force every other file in this repo that builds an `Enquiry`
// fixture (send-quote-dialog, enquiry-dialog tests, …) to learn about a field they never read,
// none of which is this task's file list. Every read site treats an absent `kind` as `'flight'`
// — never as an error state — via `enquiryKind()` below.
export const ENQUIRY_KINDS = ['flight', 'tour', 'cruise'] as const;
export type EnquiryKind = (typeof ENQUIRY_KINDS)[number];

export const KIND_LABELS: Record<EnquiryKind, string> = {
  flight: 'Flight',
  tour: 'Tour',
  cruise: 'Cruise',
};

/** `enquiry.kind` defaults to 'flight' server-side and is effectively always present, but this
 * frontend type keeps it optional (see the comment above) — this is the one place that resolves
 * the default, so every read site agrees. */
export function enquiryKind(enquiry: Pick<Enquiry, 'kind'>): EnquiryKind {
  return enquiry.kind ?? 'flight';
}

/** Tour-specific detail, present only when `kind === 'tour'`. `tourRef` is a WordPress
 * `alamo_tour` post id (a number), never a Mongo ref — display only, never populate()'d. */
export interface EnquiryTour {
  tourRef?: number;
  tourName?: string;
  destination?: string;
  preferredMonth?: string;
}

/** Cruise-specific detail, present only when `kind === 'cruise'`. `destination` stays a bare
 * `string` (not `CruiseDestination`) so a value from before the list changed, or a legacy/foreign
 * value, still round-trips through the read side without narrowing it away — see `CRUISE_DESTINATIONS`
 * below for the write-side (staff form) select options. */
export interface EnquiryCruise {
  destination?: string;
  line?: string;
  ship?: string;
  when?: string;
  isGroup?: boolean;
}

// Mirrored from the API's `Enquiry.model.ts` (`CRUISE_DESTINATIONS`) the same way `CABIN_CLASSES`/
// `TRIP_STOPS` below are — this repo has no shared schema package with the backend, so the staff
// Cruise Destination select's options are hand-synced here. Keep in sync by hand if the backend list
// changes.
export const CRUISE_DESTINATIONS = [
  'Alaska',
  'The Bahamas and the Caribbean',
  'Hawaii',
  'Russia and Scandinavia',
  'Bermuda',
  'Australia',
  'The Panama Canal',
  'Mexico',
  'Canada and New England',
  'Tahiti and Fiji',
  'Somewhere else',
] as const;
export type CruiseDestination = (typeof CRUISE_DESTINATIONS)[number];

// `Enquiry.source` — where the enquiry came from. Added weeks before this file's `kind` fields;
// only the CRM display (the badge) was missing until now. `undefined` means "predates this
// field", not "created by staff" — see `EnquirySourceBadge`.
export const ENQUIRY_SOURCES = ['website', 'staff'] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];

export interface EnquirySegment {
  from: string;
  to: string;
  date: string; // YYYY-MM-DD
  departTime?: string; // HH:mm
  arriveTime?: string;
}

export interface EnquiryFarePrices {
  adult: number;
  child?: number;
  infant?: number;
}

export interface EnquiryFareOption {
  airlineCode?: string;
  airlineName: string;
  prices: EnquiryFarePrices;
  baggageNotes?: string;
  segments: EnquirySegment[];
}

export const TRIP_TYPES = ['oneway', 'round', 'multicity'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const CABIN_CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'] as const;
export type CabinClass = (typeof CABIN_CLASSES)[number];

export const TRIP_STOPS = ['nonstop', 'upto1', 'upto2'] as const;
export type TripStops = (typeof TRIP_STOPS)[number];

export const STOPS_LABELS: Record<TripStops, string> = {
  nonstop: 'Nonstop',
  upto1: 'Up to 1 stop',
  upto2: 'Up to 2 stops',
};

/** One leg of the requested itinerary. Every field is optional — an enquiry can be
 * "Houston to Kochi, sometime in August". Distinct from EnquirySegment (a quoted fare
 * option's flight, which carries times and has required fields). */
export interface EnquiryTripSegment {
  from?: string;
  to?: string;
  date?: string; // YYYY-MM-DD
}

export interface EnquiryPax {
  adults: number;
  children: number;
  infants: number;
}

export interface EnquiryTrip {
  tripType: TripType;
  segments: EnquiryTripSegment[];
  dateFlexibility?: string;
  pax: EnquiryPax;
  budgetPerPax?: number; // USD
  cabins: CabinClass[]; // [] = no preference
  preferredAirlines: string[]; // IATA codes; [] = no preference
  stops?: TripStops; // undefined = no preference
}

export interface Enquiry {
  id: string;
  enquirer: { name: string; phone?: string; email?: string };
  // See the comment above ENQUIRY_KINDS for why this stays optional on the frontend type.
  kind?: EnquiryKind;
  trip: EnquiryTrip;
  // Only the sub-document matching `kind` is ever populated — a flight enquiry carries neither.
  tour?: EnquiryTour;
  cruise?: EnquiryCruise;
  notes?: string;
  status: EnquiryStatus;
  fareOptions: EnquiryFareOption[];
  quoteSentAt: string | null;
  createdAt: string;
  source?: EnquirySource;
}

export interface CreateEnquiryInput {
  enquirer: Enquiry['enquirer'];
  // Optional exactly like the read-side `Enquiry.kind` (see the comment above ENQUIRY_KINDS) —
  // omitted defaults to 'flight' server-side, so every pre-existing caller is unaffected.
  kind?: EnquiryKind;
  trip?: Partial<EnquiryTrip>;
  // Only the sub-document matching `kind` should ever be sent — see enquiry-dialog.tsx's payload
  // builder. The staff routes are NOT a discriminated union (an authenticated PATCH's fields are
  // all optional, and `kind` may legitimately be absent while one of these is present), so nothing
  // here stops a caller from sending both; the invariant is enforced by construction in the form.
  tour?: EnquiryTour;
  cruise?: EnquiryCruise;
  notes?: string;
}

export interface UpdateEnquiryInput extends Partial<CreateEnquiryInput> {
  status?: EnquiryStatus;
  fareOptions?: EnquiryFareOption[];
}

export interface EnquiryListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: EnquiryStatus;
}

export interface EnquiryPage {
  enquiries: Enquiry[];
  total: number;
  page: number;
  pageSize: number;
}

export const ENQUIRY_PAGE_SIZES = [10, 25, 50, 100] as const;

export async function listEnquiries(params: EnquiryListParams = {}): Promise<EnquiryPage> {
  const res = await apiClient.get<EnquiryPage>('/enquiries', { params });
  return res.data;
}

export async function createEnquiry(input: CreateEnquiryInput): Promise<Enquiry> {
  const res = await apiClient.post<Enquiry>('/enquiries', input);
  return res.data;
}

export async function getEnquiry(id: string): Promise<Enquiry> {
  const res = await apiClient.get<Enquiry>(`/enquiries/${id}`);
  return res.data;
}

export async function updateEnquiry(id: string, input: UpdateEnquiryInput): Promise<Enquiry> {
  const res = await apiClient.patch<Enquiry>(`/enquiries/${id}`, input);
  return res.data;
}

export async function deleteEnquiry(id: string): Promise<void> {
  await apiClient.delete(`/enquiries/${id}`);
}

export async function sendEnquiryQuote(
  id: string,
  input: { toEmail: string; optionIndexes: number[]; personalMessage?: string }
): Promise<{ sent: boolean }> {
  const res = await apiClient.post<{ sent: boolean }>(`/enquiries/${id}/send-quote`, input);
  return res.data;
}
