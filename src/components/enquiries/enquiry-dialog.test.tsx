import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_TIME_ZONE, agencyToday } from '@/utils/agencyTime';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { EnquiryDialog } from './enquiry-dialog';
import * as enquiriesApi from '@/api/enquiries.api';
import type { Enquiry } from '@/api/enquiries.api';
import * as flightDataApi from '@/api/flightData.api';
import { FUTURE_DEP_DATE } from '@/test-utils/dates';

// The components floor these date inputs on `agencyToday(timeZone)` — the AGENCY-local calendar
// day (America/Chicago by default; none of these tests mocks branding, so the fallback applies).
// This constant used to be `new Date().toISOString().slice(0, 10)`, i.e. the UTC day, which agrees
// with the agency day only for the 18-19 hours a day that UTC and Chicago share a date. Between
// 00:00 UTC and local midnight — 19:00-24:00 Chicago time — UTC is already tomorrow and all three
// of these assertions failed, every single night. Deriving the expectation the same way the
// component does removes the skew by construction rather than re-pinning it to a different clock.
const TODAY = agencyToday(DEFAULT_TIME_ZONE);

vi.mock('@/api/enquiries.api', async () => ({
  ...(await vi.importActual<typeof enquiriesApi>('@/api/enquiries.api')),
  createEnquiry: vi.fn(),
  updateEnquiry: vi.fn(),
}));
vi.mock('@/api/flightData.api');

function renderDialog(enquiry?: Enquiry | null) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EnquiryDialog open onOpenChange={() => {}} enquiry={enquiry} />
    </QueryClientProvider>
  );
}

/** A legacy enquiry as it exists in production data: the feature shipped with no data
 * migration, so old rows read back as `tripType: 'round'` with `segments: []`. */
const legacyRoundTripEnquiry: Enquiry = {
  id: 'legacy-1',
  enquirer: { name: 'Legacy Person' },
  trip: {
    tripType: 'round',
    segments: [],
    pax: { adults: 1, children: 0, infants: 0 },
    cabins: [],
    preferredAirlines: [],
  },
  notes: '',
  status: 'New',
  fareOptions: [],
  quoteSentAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** A saved enquiry carrying pax and cabin selections, used to prove they round-trip through the
 * dialog without driving their (jsdom-unrenderable) popovers open. */
const savedEnquiry: Enquiry = {
  ...legacyRoundTripEnquiry,
  id: 'saved-1',
  trip: {
    tripType: 'round',
    segments: [
      { from: 'IAH', to: 'COK', date: '2026-08-01' },
      { from: 'COK', to: 'IAH', date: '2026-08-25' },
    ],
    pax: { adults: 2, children: 1, infants: 0 },
    cabins: ['Business'],
    preferredAirlines: ['QR'],
  },
};

beforeEach(() => {
  // vitest isn't configured with `clearMocks`, so call history would otherwise leak between
  // tests — and every test here reads `createEnquiry.mock.calls[0]`.
  vi.clearAllMocks();
  vi.mocked(flightDataApi.searchAirports).mockResolvedValue([]);
  vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([]);
  vi.mocked(enquiriesApi.createEnquiry).mockResolvedValue({} as enquiriesApi.Enquiry);
});

describe('EnquiryDialog trip fields', () => {
  it('defaults to a round trip with two segment rows', async () => {
    renderDialog();
    expect(screen.getByLabelText('From 1')).toBeInTheDocument();
    expect(screen.getByLabelText('From 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('From 3')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add flight' })).not.toBeInTheDocument();
  });

  it('mirrors the outbound route into the return leg', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('From 1'), 'IAH');
    await user.type(screen.getByLabelText('To 1'), 'COK');

    await waitFor(() => expect(screen.getByLabelText('From 2')).toHaveValue('COK'));
    expect(screen.getByLabelText('To 2')).toHaveValue('IAH');
  });

  it('drops the return leg when switching to one-way', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: 'One-way' }));

    await waitFor(() => expect(screen.queryByLabelText('From 2')).not.toBeInTheDocument());
  });

  it('adds and removes rows in multi-city, down to a 1-row minimum', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Multi-city' }));

    await user.click(await screen.findByRole('button', { name: 'Add flight' }));
    expect(screen.getByLabelText('From 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove flight 3' }));
    await waitFor(() => expect(screen.queryByLabelText('From 3')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Remove flight 2' }));
    await waitFor(() => expect(screen.queryByLabelText('From 2')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Remove flight 1' })).not.toBeInTheDocument();
  });

  // `step` defaults to 1, so without this a budget of $1,250.50 is a stepMismatch and the browser
  // refuses this dialog's submit. jsdom does not run interactive constraint validation, so the
  // attribute is all a test here can see.
  it('accepts cents in the budget per passenger', () => {
    renderDialog();
    expect(screen.getByLabelText('Budget per passenger')).toHaveAttribute('step', '0.01');
  });

  it('submits the full trip shape', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Enquirer name'), 'Jane Doe');
    await user.type(screen.getByLabelText('From 1'), 'IAH');
    await user.type(screen.getByLabelText('To 1'), 'COK');

    await user.type(screen.getByLabelText('Budget per passenger'), '1200');

    await user.click(screen.getByRole('combobox', { name: 'Stops' }));
    await user.click(await screen.findByRole('option', { name: 'Nonstop' }));

    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(enquiriesApi.createEnquiry).toHaveBeenCalled());
    const payload = vi.mocked(enquiriesApi.createEnquiry).mock.calls[0][0];
    expect(payload.trip).toEqual(
      expect.objectContaining({
        tripType: 'round',
        pax: { adults: 1, children: 0, infants: 0 },
        budgetPerPax: 1200,
        stops: 'nonstop',
      })
    );
    expect(payload.trip?.segments?.[0]).toEqual(expect.objectContaining({ from: 'IAH', to: 'COK' }));
    expect(payload.trip?.segments?.[1]).toEqual(expect.objectContaining({ from: 'COK', to: 'IAH' }));
  });

  // Passengers and Cabin are Radix popovers nested inside the modal Dialog. jsdom cannot render
  // that nesting (it blows the call stack — the same reason no test drives the pre-existing
  // DateField calendar either), so the popovers themselves are covered standalone in
  // passenger-count-field.test.tsx / cabin-select-field.test.tsx, and their round-trip THROUGH the
  // dialog is covered here from an edit-mode fixture instead of by clicking them open.
  it('round-trips pax and cabins through an edit without opening their popovers', async () => {
    const user = userEvent.setup();
    renderDialog(savedEnquiry);

    expect(screen.getByRole('button', { name: 'Passengers' })).toHaveTextContent('2 Adults, 1 Child');
    expect(screen.getByText('BUS')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(enquiriesApi.updateEnquiry).toHaveBeenCalled());
    const [, payload] = vi.mocked(enquiriesApi.updateEnquiry).mock.calls[0];
    expect(payload.trip).toEqual(
      expect.objectContaining({
        pax: { adults: 2, children: 1, infants: 0 },
        cabins: ['Business'],
      })
    );
  });

  it('sends stops as undefined when left at "Any"', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Enquirer name'), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(enquiriesApi.createEnquiry).toHaveBeenCalled());
    expect(vi.mocked(enquiriesApi.createEnquiry).mock.calls[0][0].trip?.stops).toBeUndefined();
  });

  it('does not pin the return-leg flag when editing row 2 in multi-city, so round-trip mirroring still works after switching back', async () => {
    const user = userEvent.setup();
    renderDialog();

    // Switch to multi-city — row 2 here is an independent leg, not "the return leg".
    await user.click(screen.getByRole('radio', { name: 'Multi-city' }));

    // Hand-edit row 2. In round-trip mode this would pin returnLegTouched; in multi-city it must not.
    await user.type(screen.getByLabelText('From 2'), 'DXB');
    await user.type(screen.getByLabelText('To 2'), 'LHR');

    // Switch back to round trip — row 2 (DXB/LHR) carries over as the existing inbound leg.
    await user.click(screen.getByRole('radio', { name: 'Round trip' }));

    // Now edit leg 1's route. If the flag were incorrectly stuck true, this would NOT mirror.
    await user.type(screen.getByLabelText('From 1'), 'IAH');
    await user.type(screen.getByLabelText('To 1'), 'COK');

    await waitFor(() => expect(screen.getByLabelText('From 2')).toHaveValue('COK'));
    expect(screen.getByLabelText('To 2')).toHaveValue('IAH');
  });

  it('resets the return-leg flag when round trip is re-entered with a freshly synthesized leg 2', async () => {
    const user = userEvent.setup();
    renderDialog();

    // Fill leg 1; leg 2 auto-mirrors (flag still false).
    await user.type(screen.getByLabelText('From 1'), 'IAH');
    await user.type(screen.getByLabelText('To 1'), 'COK');
    await waitFor(() => expect(screen.getByLabelText('From 2')).toHaveValue('COK'));

    // Hand-edit leg 2 — pins the flag true.
    await user.type(screen.getByLabelText('To 2'), 'X');
    await waitFor(() => expect(screen.getByLabelText('To 2')).toHaveValue('IAHX'));

    // Drop to one-way (leg 2 is discarded)...
    await user.click(screen.getByRole('radio', { name: 'One-way' }));
    await waitFor(() => expect(screen.queryByLabelText('From 2')).not.toBeInTheDocument());

    // ...then back to round trip — leg 2 is freshly re-synthesized from leg 1, never hand-edited.
    await user.click(screen.getByRole('radio', { name: 'Round trip' }));
    await waitFor(() => expect(screen.getByLabelText('From 2')).toHaveValue('COK'));

    // Edit leg 1 again. The freshly synthesized leg 2 was never hand-edited, so this must mirror.
    await user.clear(screen.getByLabelText('From 1'));
    await user.type(screen.getByLabelText('From 1'), 'DXB');
    await user.clear(screen.getByLabelText('To 1'));
    await user.type(screen.getByLabelText('To 1'), 'LHR');

    await waitFor(() => expect(screen.getByLabelText('From 2')).toHaveValue('LHR'));
    expect(screen.getByLabelText('To 2')).toHaveValue('DXB');
  });

  it('recovers auto-mirroring after leg 2 is hand-edited, then removed and re-added via multi-city', async () => {
    const user = userEvent.setup();
    renderDialog();

    // Round trip → hand-edit leg 2's To field by hand.
    await user.type(screen.getByLabelText('To 2'), 'X');
    await waitFor(() => expect(screen.getByLabelText('To 2')).toHaveValue('X'));

    // Switch to Multi-city. resize() leaves segments untouched — row 2 (hand-edited) survives as-is.
    await user.click(screen.getByRole('radio', { name: 'Multi-city' }));

    // Remove row 2, then add a brand-new row 2 that nobody has ever touched.
    await user.click(screen.getByRole('button', { name: 'Remove flight 2' }));
    await waitFor(() => expect(screen.queryByLabelText('From 2')).not.toBeInTheDocument());
    await user.click(await screen.findByRole('button', { name: 'Add flight' }));
    expect(screen.getByLabelText('From 2')).toHaveValue('');

    // Switch back to Round trip — the fresh, never-touched row 2 carries over into slot 1.
    await user.click(screen.getByRole('radio', { name: 'Round trip' }));

    // Edit leg 1. If a stale "leg 2 was hand-edited" flag survived the detour, this would NOT mirror.
    await user.type(screen.getByLabelText('From 1'), 'IAH');
    await user.type(screen.getByLabelText('To 1'), 'COK');

    await waitFor(() => expect(screen.getByLabelText('From 2')).toHaveValue('COK'));
    expect(screen.getByLabelText('To 2')).toHaveValue('IAH');
  });

  it('reshapes a legacy enquiry (round trip, zero saved segments) to show both leg rows on open', () => {
    renderDialog(legacyRoundTripEnquiry);

    expect(screen.getByLabelText('From 1')).toBeInTheDocument();
    expect(screen.getByLabelText('From 2')).toBeInTheDocument();
  });

  it('lets a legacy enquiry’s synthesized leg 2 still auto-mirror leg 1, since it was never hand-edited', async () => {
    const user = userEvent.setup();
    renderDialog(legacyRoundTripEnquiry);

    await user.type(screen.getByLabelText('From 1'), 'IAH');
    await user.type(screen.getByLabelText('To 1'), 'COK');

    await waitFor(() => expect(screen.getByLabelText('From 2')).toHaveValue('COK'));
    expect(screen.getByLabelText('To 2')).toHaveValue('IAH');
  });
});

describe('EnquiryDialog success toasts', () => {
  it('toasts "Enquiry created" after a successful create', async () => {
    const user = userEvent.setup();
    const successSpy = vi.spyOn(toast, 'success');

    renderDialog();

    await user.type(screen.getByLabelText('Enquirer name'), 'Jane Doe');
    await user.type(screen.getByLabelText('From 1'), 'IAH');
    await user.type(screen.getByLabelText('To 1'), 'COK');

    await user.type(screen.getByLabelText('Budget per passenger'), '1200');

    await user.click(screen.getByRole('combobox', { name: 'Stops' }));
    await user.click(await screen.findByRole('option', { name: 'Nonstop' }));

    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Enquiry created'));
    successSpy.mockRestore();
  });
});

describe('EnquiryDialog future-only travel dates', () => {
  it('floors each leg at today when creating', () => {
    renderDialog();
    expect(screen.getByLabelText('Date 1')).toHaveAttribute('min', TODAY);
    expect(screen.getByLabelText('Date 2')).toHaveAttribute('min', TODAY);
  });

  it('raises a later leg to the date of the leg before it', () => {
    renderDialog();
    // Legs are flown in order, so leg 2 can't precede leg 1.
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: FUTURE_DEP_DATE } });
    expect(screen.getByLabelText('Date 2')).toHaveAttribute('min', FUTURE_DEP_DATE);
  });

  it('does NOT floor the dates when editing, so a stale enquiry stays correctable', () => {
    renderDialog(savedEnquiry);
    expect(screen.getByLabelText('Date 1')).not.toHaveAttribute('min');
    expect(screen.getByLabelText('Date 2')).not.toHaveAttribute('min');
  });
});
