import { render, screen, waitFor } from '@testing-library/react';
import { FUTURE_DEP_DATE } from '@/test-utils/dates';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { toast } from 'sonner';
import EnquiryDetailPage from './EnquiryDetailPage';
import * as enquiriesApi from '../api/enquiries.api';
import * as flightDataApi from '../api/flightData.api';
import * as auditApi from '../api/audit.api';
import { useAuthStore } from '../stores/authStore';

// A bare `vi.mock('../api/audit.api')` would automock AUDIT_ACTION_LABELS/auditActionLabel to
// `undefined`, breaking the history panel's action-label lookup — spread the real module.
vi.mock('../api/audit.api', async (importActual) => ({
  ...(await importActual<typeof auditApi>()),
  listAuditEntries: vi.fn(),
}));

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigateMock,
  useParams: () => ({ enquiryId: 'e1' }),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const OPTION: enquiriesApi.EnquiryFareOption = {
  airlineCode: 'NK',
  airlineName: 'Spirit Airlines',
  prices: { adult: 220 },
  baggageNotes: 'Personal baggage might be allowed.',
  segments: [{ from: 'IAH', to: 'LAX', date: '2026-07-08', departTime: '06:20', arriveTime: '07:47' }],
};

const ENQUIRY: enquiriesApi.Enquiry = {
  id: 'e1',
  enquirer: { name: 'Johny Smith', phone: '555-0100', email: 'johny@example.com' },
  trip: {
    tripType: 'round' as const,
    segments: [
      { from: 'IAH', to: 'LAX', date: '2026-07-08' },
      { from: 'LAX', to: 'IAH', date: '2026-07-12' },
    ],
    dateFlexibility: '±3 days',
    pax: { adults: 2, children: 1, infants: 0 },
    budgetPerPax: 1200,
    cabins: ['Business' as const],
    preferredAirlines: ['QR'],
    stops: 'nonstop' as const,
  },
  notes: 'Morning preferred',
  status: 'New',
  fareOptions: [OPTION],
  quoteSentAt: null,
  createdAt: '2026-07-12T10:00:00.000Z',
};

const DELETER = {
  id: 'ud',
  name: 'Deleter',
  email: 'deleter@a.test',
  role: 'agent' as const,
  permissions: {
    bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
    customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
    groups: { createShared: false },
    data: { viewReports: false },
    enquiries: { sendQuote: false, edit: true, delete: true },
  },
};

describe('EnquiryDetailPage', () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // The edit affordances (status picker, fare-option add/edit/remove, Edit button) are gated
    // by `enquiries.edit`, so the default here must hold it or those tests render nothing to
    // drive. Tests asserting a NARROWER permission set still override this explicitly.
    useAuthStore.setState({ accessToken: 't', user: DELETER });
    vi.spyOn(enquiriesApi, 'getEnquiry').mockResolvedValue(ENQUIRY);
    vi.spyOn(flightDataApi, 'searchAirports').mockResolvedValue([]);
    vi.spyOn(flightDataApi, 'searchAirlines').mockResolvedValue([]);
  });

  it('shows a skeleton while the enquiry is loading', () => {
    vi.spyOn(enquiriesApi, 'getEnquiry').mockReturnValue(new Promise(() => {}));
    renderWithClient(<EnquiryDetailPage />);
    expect(screen.getAllByTestId('detail-skeleton').length).toBeGreaterThan(0);
  });

  it('renders enquirer, trip, notes, status, and the saved fare options', async () => {
    renderWithClient(<EnquiryDetailPage />);
    expect(await screen.findByText('Johny Smith')).toBeInTheDocument();
    expect(screen.getByText(/555-0100/)).toBeInTheDocument();
    expect(screen.getByText(/IAH → LAX/)).toBeInTheDocument();
    expect(screen.getByText(/±3 days/)).toBeInTheDocument();
    expect(screen.getByText('Morning preferred')).toBeInTheDocument();
    expect(screen.getByText(/Spirit Airlines/)).toBeInTheDocument();
    expect(screen.getByText(/Adult USD220\.00/)).toBeInTheDocument();
    expect(screen.getByText(/IAH to LAX/)).toBeInTheDocument();
  });

  it('shows only the quoted pax types on a fare option', async () => {
    // fareOptions[0] has prices { adult: 220 } only
    renderWithClient(<EnquiryDetailPage />);

    expect(await screen.findByText(/Adult USD220\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/Child/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Infant/)).not.toBeInTheDocument();
  });

  // --- Enquiry kinds + website provenance badge (2026-08-08) ---

  it('a flight enquiry (kind absent) renders no cruise/tour fields and no website badge', async () => {
    // ENQUIRY has no `kind`, `tour`, `cruise`, or `source` — the shape every pre-existing
    // enquiry has. The regression guard: nothing new should render for it.
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    expect(screen.queryByText(/Cruise destination/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cruise line/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ship:')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Tour:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tour destination/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Preferred month/)).not.toBeInTheDocument();
    expect(screen.queryByText('Website')).not.toBeInTheDocument();
  });

  it('shows the website badge for a website-sourced enquiry', async () => {
    vi.spyOn(enquiriesApi, 'getEnquiry').mockResolvedValue({ ...ENQUIRY, source: 'website' });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');
    expect(screen.getByText('Website')).toBeInTheDocument();
  });

  it('renders cruise fields for a cruise enquiry', async () => {
    vi.spyOn(enquiriesApi, 'getEnquiry').mockResolvedValue({
      ...ENQUIRY,
      kind: 'cruise',
      cruise: { destination: 'Alaska', line: 'Carnival', ship: 'Carnival Spirit', when: 'Flexible', isGroup: true },
    });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    expect(screen.getByText('Alaska')).toBeInTheDocument();
    expect(screen.getByText('Carnival')).toBeInTheDocument();
    expect(screen.getByText('Carnival Spirit')).toBeInTheDocument();
    expect(screen.getByText('Flexible')).toBeInTheDocument();
    expect(screen.getByText(/50\+ passengers/)).toBeInTheDocument();
    // No tour fields on a cruise enquiry.
    expect(screen.queryByText(/^Tour:/)).not.toBeInTheDocument();
  });

  it('renders tour fields for a tour enquiry', async () => {
    vi.spyOn(enquiriesApi, 'getEnquiry').mockResolvedValue({
      ...ENQUIRY,
      kind: 'tour',
      tour: { tourName: 'Holy Land Pilgrimage', destination: 'Jordan', preferredMonth: 'March' },
    });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    expect(screen.getByText('Holy Land Pilgrimage')).toBeInTheDocument();
    expect(screen.getByText('Jordan')).toBeInTheDocument();
    expect(screen.getByText('March')).toBeInTheDocument();
    // No cruise fields on a tour enquiry.
    expect(screen.queryByText(/Cruise destination/)).not.toBeInTheDocument();
  });

  // final-review Minor 3 (2026-08-08): `buildTrip()` omits `tripType`/`segments` for a
  // non-flight kind, so Mongoose's `default: 'round'`/`default: []` apply — a REAL cruise
  // or tour enquiry from the website carries exactly this shape (empty segments, tripType
  // 'round'), not the flight-shaped fixture the two tests above reuse for convenience.
  it('a cruise enquiry with no itinerary does not claim to be a round trip, and states its kind', async () => {
    vi.spyOn(enquiriesApi, 'getEnquiry').mockResolvedValue({
      ...ENQUIRY,
      kind: 'cruise',
      trip: { tripType: 'round', segments: [], pax: { adults: 50, children: 0, infants: 0 }, cabins: [], preferredAirlines: [] },
      cruise: { destination: 'Alaska', isGroup: true },
    });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    expect(screen.getByText('Kind:')).toBeInTheDocument();
    expect(screen.getByText('Cruise')).toBeInTheDocument();
    // The bug: this used to render "Route: — (Round trip)" for every non-flight kind.
    expect(screen.queryByText('Route:')).not.toBeInTheDocument();
    expect(screen.queryByText('Dates:')).not.toBeInTheDocument();
    expect(screen.queryByText(/Round trip/)).not.toBeInTheDocument();
  });

  it('a tour enquiry with no fields filled in still states its kind, distinguishing it from a flight enquiry', async () => {
    vi.spyOn(enquiriesApi, 'getEnquiry').mockResolvedValue({
      ...ENQUIRY,
      kind: 'tour',
      trip: { tripType: 'round', segments: [], pax: { adults: 2, children: 0, infants: 0 }, cabins: [], preferredAirlines: [] },
      tour: {},
    });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    expect(screen.getByText('Kind:')).toBeInTheDocument();
    expect(screen.getByText('Tour')).toBeInTheDocument();
    expect(screen.queryByText('Route:')).not.toBeInTheDocument();
    expect(screen.queryByText(/Round trip/)).not.toBeInTheDocument();
  });

  it('a flight enquiry states its kind as Flight and still shows Route/Dates', async () => {
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    expect(screen.getByText('Kind:')).toBeInTheDocument();
    expect(screen.getByText('Flight')).toBeInTheDocument();
    expect(screen.getByText('Route:')).toBeInTheDocument();
    expect(screen.getByText(/Round trip/)).toBeInTheDocument();
  });

  it('changes status via the status select (PATCH)', async () => {
    const update = vi.spyOn(enquiriesApi, 'updateEnquiry').mockResolvedValue({ ...ENQUIRY, status: 'Booked' });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Booked' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('e1', { status: 'Booked' });
    });
  });

  it('adds a fare option via the dialog and PATCHes the whole array', async () => {
    const update = vi.spyOn(enquiriesApi, 'updateEnquiry').mockResolvedValue(ENQUIRY);
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    await userEvent.click(screen.getByRole('button', { name: 'Add fare option' }));
    await userEvent.type(screen.getByLabelText('Airline'), 'United Airlines');
    await userEvent.type(screen.getByLabelText('Adult fare'), '470');
    await userEvent.type(screen.getByLabelText('Segment 1 from'), 'IAH');
    await userEvent.type(screen.getByLabelText('Segment 1 to'), 'LAX');
    await userEvent.type(screen.getByLabelText('Segment 1 date'), FUTURE_DEP_DATE);
    await userEvent.type(screen.getByLabelText('Segment 1 depart time'), '07:36');
    await userEvent.type(screen.getByLabelText('Segment 1 arrive time'), '09:05');
    await userEvent.type(screen.getByLabelText('Baggage notes'), 'Carry-on baggage is allowed.');
    await userEvent.click(screen.getByRole('button', { name: 'Save option' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('e1', {
        fareOptions: [
          OPTION,
          {
            airlineCode: undefined,
            airlineName: 'United Airlines',
            prices: { adult: 470, child: undefined, infant: undefined },
            baggageNotes: 'Carry-on baggage is allowed.',
            segments: [{ from: 'IAH', to: 'LAX', date: FUTURE_DEP_DATE, departTime: '07:36', arriveTime: '09:05' }],
          },
        ],
      });
    });
  });

  it('adds and removes segment rows inside the option dialog (min 1)', async () => {
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');
    await userEvent.click(screen.getByRole('button', { name: 'Add fare option' }));

    expect(screen.getByRole('button', { name: 'Remove segment 1' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Add segment' }));
    expect(screen.getByLabelText('Segment 2 from')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove segment 2' }));
    expect(screen.queryByLabelText('Segment 2 from')).not.toBeInTheDocument();
  });

  it('removes a fare option', async () => {
    const update = vi.spyOn(enquiriesApi, 'updateEnquiry').mockResolvedValue({ ...ENQUIRY, fareOptions: [] });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    await userEvent.click(screen.getByRole('button', { name: 'Remove option 1' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('e1', { fareOptions: [] });
    });
  });

  it('deletes the enquiry after confirm and navigates back to the list', async () => {
    const del = vi.spyOn(enquiriesApi, 'deleteEnquiry').mockResolvedValue(undefined);
    useAuthStore.setState({ accessToken: 't', user: DELETER });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete enquiry' }));

    await waitFor(() => {
      expect(del).toHaveBeenCalledWith('e1');
      expect(navigateMock).toHaveBeenCalledWith({ to: '/enquiries' });
    });
  });

  it('toasts "Enquiry deleted" after a successful delete', async () => {
    const del = vi.spyOn(enquiriesApi, 'deleteEnquiry').mockResolvedValue(undefined);
    useAuthStore.setState({ accessToken: 't', user: DELETER });
    const successSpy = vi.spyOn(toast, 'success');
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete enquiry' }));

    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Enquiry deleted'));
    expect(del).toHaveBeenCalledWith('e1');
    successSpy.mockRestore();
  });

  it('hides Delete from a user without enquiries.delete', async () => {
    // Deleting an enquiry used to be ungated, so any authenticated user could destroy one.
    useAuthStore.setState({
      accessToken: 't',
      user: { ...DELETER, permissions: { ...DELETER.permissions, enquiries: { sendQuote: false, edit: true, delete: false } } },
    });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  // --- Audit history mount: gated on canViewAudit(user) — an Agent must not see it. ---

  it('shows the enquiry history to a superadmin', async () => {
    vi.mocked(auditApi.listAuditEntries).mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 25 });
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'u0', name: 'Super', email: 'super@a.test', role: 'superadmin' },
    });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');

    expect(await screen.findByText('History')).toBeInTheDocument();
    await waitFor(() =>
      expect(auditApi.listAuditEntries).toHaveBeenCalledWith(
        expect.objectContaining({ targetCollection: 'enquiries', targetId: 'e1' })
      )
    );
  });

  it('hides the history from an agent', async () => {
    useAuthStore.setState({ accessToken: 't', user: DELETER });
    renderWithClient(<EnquiryDetailPage />);
    await screen.findByText('Johny Smith');
    expect(screen.queryByText('History')).not.toBeInTheDocument();
  });

  describe('Send Quote permission gating', () => {
    const SUPERADMIN = { id: 'u0', name: 'Super', email: 'super@a.test', role: 'superadmin' as const };
    const ADMIN = { id: 'u1', name: 'Admin', email: 'admin@a.test', role: 'admin' as const };
    const AGENT_NO_SEND_QUOTE = {
      id: 'u2',
      name: 'No Quote Agent',
      email: 'agent-noquote@a.test',
      role: 'agent' as const,
      permissions: {
        bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
        customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
        groups: { createShared: false },
        data: { viewReports: false },
        enquiries: { sendQuote: false, edit: false, delete: false },
      },
    };
    const AGENT_WITH_SEND_QUOTE = {
      ...AGENT_NO_SEND_QUOTE,
      id: 'u3',
      permissions: {
        ...AGENT_NO_SEND_QUOTE.permissions,
        enquiries: { sendQuote: true, edit: true, delete: true },
      },
    };

    afterEach(() => {
      useAuthStore.setState({ accessToken: null, user: null });
    });

    it('a superadmin sees the Send Quote button', async () => {
      useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
      renderWithClient(<EnquiryDetailPage />);
      expect(await screen.findByRole('button', { name: 'Send Quote' })).toBeInTheDocument();
    });

    it('an admin sees the Send Quote button with no explicit grant', async () => {
      useAuthStore.setState({ accessToken: 't', user: ADMIN });
      renderWithClient(<EnquiryDetailPage />);
      expect(await screen.findByRole('button', { name: 'Send Quote' })).toBeInTheDocument();
    });

    it('an agent without enquiries.sendQuote does not see the Send Quote button', async () => {
      useAuthStore.setState({ accessToken: 't', user: AGENT_NO_SEND_QUOTE });
      renderWithClient(<EnquiryDetailPage />);
      await screen.findByText('Johny Smith');
      expect(screen.queryByRole('button', { name: 'Send Quote' })).not.toBeInTheDocument();
    });

    it('an agent with enquiries.sendQuote sees the Send Quote button', async () => {
      useAuthStore.setState({ accessToken: 't', user: AGENT_WITH_SEND_QUOTE });
      renderWithClient(<EnquiryDetailPage />);
      expect(await screen.findByRole('button', { name: 'Send Quote' })).toBeInTheDocument();
    });
  });
});
