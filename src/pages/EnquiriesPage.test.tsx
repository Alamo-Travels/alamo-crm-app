import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import EnquiriesPage from './EnquiriesPage';
import * as enquiriesApi from '../api/enquiries.api';
import * as flightDataApi from '../api/flightData.api';

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigateMock,
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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
  notes: 'Morning flights preferred',
  status: 'New',
  fareOptions: [],
  quoteSentAt: null,
  createdAt: '2026-07-12T10:00:00.000Z',
};

describe('EnquiriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(enquiriesApi, 'listEnquiries').mockResolvedValue({ enquiries: [ENQUIRY], total: 1, page: 1, pageSize: 25 });
    vi.spyOn(flightDataApi, 'searchAirports').mockResolvedValue([]);
  });

  it('shows skeleton rows while enquiries are loading', () => {
    vi.mocked(enquiriesApi.listEnquiries).mockReturnValue(new Promise(() => {}));
    renderWithClient(<EnquiriesPage />);
    expect(screen.getAllByTestId('table-skeleton-row').length).toBeGreaterThan(0);
    expect(screen.queryByText('No enquiries found.')).not.toBeInTheDocument();
  });

  it('lists enquiries with enquirer, route, dates (with flexibility), pax, and status', async () => {
    renderWithClient(<EnquiriesPage />);
    expect(await screen.findByText('Johny Smith')).toBeInTheDocument();
    expect(screen.getByText('555-0100')).toBeInTheDocument();
    expect(screen.getByText('IAH → LAX → IAH')).toBeInTheDocument();
    expect(screen.getByText(/08 Jul 2026/)).toBeInTheDocument();
    expect(screen.getByText(/±3 days/)).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('renders the full itinerary and pax breakdown', async () => {
    renderWithClient(<EnquiriesPage />);
    expect(await screen.findByText('IAH → LAX → IAH')).toBeInTheDocument();
    expect(screen.getByText('2 ADT, 1 CHD')).toBeInTheDocument();
  });

  it('debounces the search box into a server-side q param', async () => {
    renderWithClient(<EnquiriesPage />);
    await userEvent.type(screen.getByLabelText('Search enquiries'), 'johny');
    await waitFor(() => {
      const lastCall = vi.mocked(enquiriesApi.listEnquiries).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ q: 'johny' });
    });
  });

  it('filters by status via the faceted filter', async () => {
    renderWithClient(<EnquiriesPage />);
    await userEvent.click(screen.getByRole('button', { name: /Status/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Quoted' }));
    await waitFor(() => {
      const lastCall = vi.mocked(enquiriesApi.listEnquiries).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ status: 'Quoted' });
    });
  });

  it('creates an enquiry via the New Enquiry dialog', async () => {
    const create = vi.spyOn(enquiriesApi, 'createEnquiry').mockResolvedValue(ENQUIRY);
    renderWithClient(<EnquiriesPage />);

    await userEvent.click(screen.getByRole('button', { name: 'New Enquiry' }));
    await userEvent.type(screen.getByLabelText('Enquirer name'), 'Johny Smith');
    await userEvent.type(screen.getByLabelText('Phone'), '555-0100');
    await userEvent.type(screen.getByLabelText('Email'), 'johny@example.com');
    await userEvent.type(screen.getByLabelText('From 1'), 'IAH');
    await userEvent.type(screen.getByLabelText('To 1'), 'LAX');
    await userEvent.type(screen.getByLabelText('Date flexibility'), '±3 days');
    await userEvent.type(screen.getByLabelText('Notes'), 'Morning flights preferred');
    await userEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          // PhoneInput masks as-typed; '5550100' (7 digits) masks to '(555)-010-0'.
          enquirer: { name: 'Johny Smith', phone: '(555)-010-0', email: 'johny@example.com' },
          trip: expect.objectContaining({
            segments: [
              expect.objectContaining({ from: 'IAH', to: 'LAX' }),
              expect.objectContaining({ from: 'LAX', to: 'IAH' }),
            ],
            // Pax steppers live in a popover jsdom can't render inside the modal dialog (see
            // enquiry-dialog.test.tsx); the default carries through unchanged here.
            pax: { adults: 1, children: 0, infants: 0 },
          }),
          notes: 'Morning flights preferred',
        })
      );
    });
  });

  it('hides the second segment row for a one-way trip', async () => {
    renderWithClient(<EnquiriesPage />);
    await userEvent.click(screen.getByRole('button', { name: 'New Enquiry' }));
    expect(screen.getByLabelText('Date 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'One-way' }));
    expect(screen.queryByLabelText('Date 2')).not.toBeInTheDocument();
  });

  it('navigates to the detail page when a row is clicked', async () => {
    renderWithClient(<EnquiriesPage />);
    await userEvent.click(await screen.findByText('Johny Smith'));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/enquiries/$enquiryId', params: { enquiryId: 'e1' } });
  });
});
