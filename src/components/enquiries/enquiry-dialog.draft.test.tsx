import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnquiryDialog } from './enquiry-dialog';
import { useAuthStore } from '@/stores/authStore';
import { readDraft, writeDraft } from '@/utils/formDraft';
import * as enquiriesApi from '@/api/enquiries.api';
import * as flightDataApi from '@/api/flightData.api';

// Copied from enquiry-dialog.test.tsx's mocks verbatim.
vi.mock('@/api/enquiries.api', async (importActual) => ({
  ...(await importActual<typeof import('@/api/enquiries.api')>()),
  createEnquiry: vi.fn(),
  updateEnquiry: vi.fn(),
}));
vi.mock('@/api/flightData.api');

const USER = { id: 'u1', name: 'Agent', email: 'a@example.com', role: 'superadmin' as const };

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EnquiryDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>
  );
  return { onOpenChange };
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ accessToken: 't', user: USER });
  vi.mocked(flightDataApi.searchAirports).mockResolvedValue([]);
  vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([]);
  vi.mocked(enquiriesApi.createEnquiry).mockResolvedValue({} as enquiriesApi.Enquiry);
});

describe('EnquiryDialog drafts', () => {
  it('auto-saves the enquirer name', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText('Enquirer name'), 'Ravi');

    await waitFor(
      () => expect(readDraft<{ name: string }>('u1', 'enquiry')?.state.name).toBe('Ravi'),
      { timeout: 2000 }
    );
  });

  it('does not treat an untouched form as content', async () => {
    renderDialog();
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(readDraft('u1', 'enquiry')).toBeNull();
  });

  it('restores a stored draft on demand', async () => {
    writeDraft('u1', 'enquiry', {
      name: 'Drafted Enquirer',
      phone: '',
      email: '',
      kind: 'flight',
      tripType: 'round',
      segments: [
        { from: '', to: '', date: '' },
        { from: '', to: '', date: '' },
      ],
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
    });

    renderDialog();
    expect(screen.getByLabelText('Enquirer name')).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    // Multiple restored fields, not just the name — a restore that dropped a field would still
    // pass a check of the name alone. See the probe in the task report for the exact failure
    // this caught (budgetPerPax and stops both reverted to their emptyForm defaults).
    expect(screen.getByLabelText('Enquirer name')).toHaveValue('Drafted Enquirer');
  });

  it('restores multiple fields, not just the name', async () => {
    writeDraft('u1', 'enquiry', {
      name: 'Drafted Enquirer',
      phone: '',
      email: '',
      kind: 'flight',
      tripType: 'round',
      segments: [
        { from: '', to: '', date: '' },
        { from: '', to: '', date: '' },
      ],
      dateFlexibility: '48 hours either way',
      pax: { adults: 1, children: 0, infants: 0 },
      budgetPerPax: '1500',
      cabins: [],
      preferredAirlines: [],
      stops: 'nonstop',
      notes: 'Prefers morning flights',
      tourRef: undefined,
      tourName: '',
      tourDestination: '',
      tourPreferredMonth: '',
      cruiseDestination: '',
      cruiseLine: '',
      cruiseShip: '',
      cruiseWhen: '',
      cruiseIsGroup: false,
    });

    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(screen.getByLabelText('Enquirer name')).toHaveValue('Drafted Enquirer');
    expect(screen.getByLabelText('Date flexibility')).toHaveValue('48 hours either way');
    expect(screen.getByLabelText('Budget per passenger')).toHaveValue(1500);
    expect(screen.getByLabelText('Notes')).toHaveValue('Prefers morning flights');
    expect(screen.getByRole('combobox', { name: 'Stops' })).toHaveTextContent('Nonstop');
  });

  it('Cancel with content asks, and Keep as draft preserves it', async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.type(screen.getByLabelText('Enquirer name'), 'Ravi');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/leave this enquiry/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep as draft' }));
    expect(readDraft<{ name: string }>('u1', 'enquiry')?.state.name).toBe('Ravi');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
