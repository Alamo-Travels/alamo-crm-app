import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnquiryDialog } from './enquiry-dialog';
import * as enquiriesApi from '@/api/enquiries.api';
import { CRUISE_DESTINATIONS } from '@/api/enquiries.api';
import type { Enquiry } from '@/api/enquiries.api';
import * as flightDataApi from '@/api/flightData.api';

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

/** A website-originated tour enquiry: the CRM cannot pick a `tourRef` (a WordPress post id), so
 * the form must never ask for it — but it must still round-trip through a staff edit. */
const tourEnquiry: Enquiry = {
  id: 'tour-1',
  enquirer: { name: 'Priya Nair' },
  kind: 'tour',
  trip: {
    tripType: 'round',
    segments: [],
    pax: { adults: 2, children: 0, infants: 0 },
    cabins: [],
    preferredAirlines: [],
  },
  tour: {
    tourRef: 4821,
    tourName: 'Kerala Backwaters',
    destination: 'Kerala',
    preferredMonth: 'December',
  },
  notes: '',
  status: 'New',
  fareOptions: [],
  quoteSentAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(flightDataApi.searchAirports).mockResolvedValue([]);
  vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([]);
  vi.mocked(enquiriesApi.createEnquiry).mockResolvedValue({} as enquiriesApi.Enquiry);
  vi.mocked(enquiriesApi.updateEnquiry).mockResolvedValue({} as enquiriesApi.Enquiry);
});

describe('EnquiryDialog kind selector — flight regression guard', () => {
  it('renders a flight enquiry exactly as it does today: Kind defaults to Flight, trip fields present, no tour/cruise fields', () => {
    renderDialog();

    expect(screen.getByRole('radio', { name: 'Flight' })).toBeChecked();
    // The existing flight-only surface is untouched.
    expect(screen.getByLabelText('Trip type')).toBeInTheDocument();
    expect(screen.getByLabelText('From 1')).toBeInTheDocument();
    expect(screen.getByLabelText('To 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Date 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Passengers' })).toBeInTheDocument();
    expect(screen.getByLabelText('Preferred airlines')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Stops' })).toBeInTheDocument();

    // No tour/cruise fields leak into the default flight form.
    expect(screen.queryByLabelText('Tour name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cruise line')).not.toBeInTheDocument();
  });

  it('submits kind: "flight" and no tour/cruise sub-document on an ordinary create', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Enquirer name'), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(enquiriesApi.createEnquiry).toHaveBeenCalled());
    const payload = vi.mocked(enquiriesApi.createEnquiry).mock.calls[0][0];
    expect(payload.kind).toBe('flight');
    expect(payload.tour).toBeUndefined();
    expect(payload.cruise).toBeUndefined();
  });
});

describe('EnquiryDialog kind selector — Tour', () => {
  it('shows the tour fields and hides flight and cruise fields', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Tour' }));

    expect(screen.getByLabelText('Tour name')).toBeInTheDocument();
    expect(screen.getByLabelText('Tour destination')).toBeInTheDocument();
    expect(screen.getByLabelText('Preferred month')).toBeInTheDocument();

    expect(screen.queryByLabelText('Trip type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('From 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cruise line')).not.toBeInTheDocument();
  });

  it('submits kind: "tour" with the tour sub-document and no cruise sub-document', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Enquirer name'), 'Priya Nair');
    await user.click(screen.getByRole('radio', { name: 'Tour' }));
    await user.type(screen.getByLabelText('Tour name'), 'Kerala Backwaters');
    await user.type(screen.getByLabelText('Tour destination'), 'Kerala');
    await user.type(screen.getByLabelText('Preferred month'), 'December');

    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(enquiriesApi.createEnquiry).toHaveBeenCalled());
    const payload = vi.mocked(enquiriesApi.createEnquiry).mock.calls[0][0];
    expect(payload.kind).toBe('tour');
    expect(payload.tour).toEqual(
      expect.objectContaining({
        tourName: 'Kerala Backwaters',
        destination: 'Kerala',
        preferredMonth: 'December',
      })
    );
    expect(payload.cruise).toBeUndefined();
  });
});

describe('EnquiryDialog kind selector — Cruise', () => {
  it('shows the cruise fields and hides flight and tour fields', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Cruise' }));

    expect(screen.getByRole('combobox', { name: 'Cruise destination' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cruise line')).toBeInTheDocument();
    expect(screen.getByLabelText('Ship')).toBeInTheDocument();
    expect(screen.getByLabelText('When')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /group booking/i })).toBeInTheDocument();

    expect(screen.queryByLabelText('Trip type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tour name')).not.toBeInTheDocument();
  });

  it('offers the shared CRUISE_DESTINATIONS list in the Destination select', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Cruise' }));
    await user.click(screen.getByRole('combobox', { name: 'Cruise destination' }));

    for (const destination of CRUISE_DESTINATIONS) {
      expect(await screen.findByRole('option', { name: destination })).toBeInTheDocument();
    }
  });

  it('submits kind: "cruise" with the cruise sub-document and no tour sub-document', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Enquirer name'), 'Sam Fisher');
    await user.click(screen.getByRole('radio', { name: 'Cruise' }));
    await user.click(screen.getByRole('combobox', { name: 'Cruise destination' }));
    await user.click(await screen.findByRole('option', { name: 'Alaska' }));
    await user.type(screen.getByLabelText('Cruise line'), 'Royal Caribbean');
    await user.type(screen.getByLabelText('Ship'), 'Ovation of the Seas');
    await user.type(screen.getByLabelText('When'), 'flexible');
    await user.click(screen.getByRole('checkbox', { name: /group booking/i }));

    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(enquiriesApi.createEnquiry).toHaveBeenCalled());
    const payload = vi.mocked(enquiriesApi.createEnquiry).mock.calls[0][0];
    expect(payload.kind).toBe('cruise');
    expect(payload.cruise).toEqual(
      expect.objectContaining({
        destination: 'Alaska',
        line: 'Royal Caribbean',
        ship: 'Ovation of the Seas',
        when: 'flexible',
        isGroup: true,
      })
    );
    expect(payload.tour).toBeUndefined();
  });
});

describe('EnquiryDialog kind selector — switching clears the other kind', () => {
  it('clears cruise field values from form state and payload after switching from Cruise to Tour', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Enquirer name'), 'Alex Kim');
    await user.click(screen.getByRole('radio', { name: 'Cruise' }));
    await user.type(screen.getByLabelText('Cruise line'), 'Royal Caribbean');
    await user.type(screen.getByLabelText('Ship'), 'Ovation of the Seas');

    await user.click(screen.getByRole('radio', { name: 'Tour' }));
    // The cruise fields are gone from the DOM, and — the point of this test — their VALUES were
    // cleared in form state, not just hidden: switching back to Cruise proves it.
    await user.click(screen.getByRole('radio', { name: 'Cruise' }));
    expect(screen.getByLabelText('Cruise line')).toHaveValue('');
    expect(screen.getByLabelText('Ship')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(enquiriesApi.createEnquiry).toHaveBeenCalled());
    const payload = vi.mocked(enquiriesApi.createEnquiry).mock.calls[0][0];
    expect(payload.kind).toBe('cruise');
    expect(payload.cruise).toEqual(
      expect.objectContaining({ line: undefined, ship: undefined })
    );
  });
});

describe('EnquiryDialog kind selector — tourRef survives an edit', () => {
  it('opens a website-originated tour enquiry without ever showing tourRef, and preserves it unchanged in the PATCH payload', async () => {
    const user = userEvent.setup();
    renderDialog(tourEnquiry);

    expect(screen.getByRole('radio', { name: 'Tour' })).toBeChecked();
    expect(screen.getByLabelText('Tour name')).toHaveValue('Kerala Backwaters');
    // tourRef is never rendered as an input anywhere in the form.
    expect(screen.queryByLabelText(/tour ref/i)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('4821')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(enquiriesApi.updateEnquiry).toHaveBeenCalled());
    const [, payload] = vi.mocked(enquiriesApi.updateEnquiry).mock.calls[0];
    expect(payload.tour).toEqual(
      expect.objectContaining({
        tourRef: 4821,
        tourName: 'Kerala Backwaters',
        destination: 'Kerala',
        preferredMonth: 'December',
      })
    );
  });

  it('still preserves tourRef even after the staff member edits the visible tour fields', async () => {
    const user = userEvent.setup();
    renderDialog(tourEnquiry);

    const nameField = screen.getByLabelText('Tour name');
    await user.clear(nameField);
    await user.type(nameField, 'Kerala Backwaters (Deluxe)');

    await user.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(enquiriesApi.updateEnquiry).toHaveBeenCalled());
    const [, payload] = vi.mocked(enquiriesApi.updateEnquiry).mock.calls[0];
    expect(payload.tour).toEqual(
      expect.objectContaining({ tourRef: 4821, tourName: 'Kerala Backwaters (Deluxe)' })
    );
  });
});

describe('EnquiryDialog kind selector — round-tripping through a kind toggle', () => {
  it('preserves tourRef through a Tour -> Flight -> Tour toggle', async () => {
    // tourRef is invisible and unretypeable, so clearing it on a toggle silently severed a
    // website-originated enquiry's link to its tour with nothing on screen to show it had gone.
    const user = userEvent.setup();
    renderDialog(tourEnquiry);

    await user.click(screen.getByRole('radio', { name: 'Flight' }));
    await user.click(screen.getByRole('radio', { name: 'Tour' }));

    // The visible tour fields are legitimately cleared by the switch; re-enter one so the payload
    // is realistic, then confirm the hidden ref came back with it.
    await user.type(screen.getByLabelText('Tour name'), 'Kerala Backwaters');
    await user.click(screen.getByRole('button', { name: /save|update/i }));

    await waitFor(() => expect(enquiriesApi.updateEnquiry).toHaveBeenCalled());
    const [, payload] = vi.mocked(enquiriesApi.updateEnquiry).mock.calls[0];
    expect(payload.kind).toBe('tour');
    expect(payload.tour?.tourRef).toBe(4821);
  });

  it('re-derives the group tick when switching back to Cruise with a 50-strong party', async () => {
    // The auto-tick otherwise only fires on a pax change, so a Cruise -> Tour -> Cruise toggle
    // left a 50-passenger party unflagged — exactly the enquiry the flag exists for.
    const user = userEvent.setup();
    renderDialog({
      ...tourEnquiry,
      id: 'cruise-toggle',
      kind: 'cruise',
      tour: undefined,
      cruise: { destination: 'Alaska' },
      trip: { ...tourEnquiry.trip, pax: { adults: 50, children: 0, infants: 0 } },
    });

    await user.click(screen.getByRole('radio', { name: 'Tour' }));
    await user.click(screen.getByRole('radio', { name: 'Cruise' }));

    expect(screen.getByRole('checkbox', { name: /group booking/i })).toBeChecked();
  });
});
