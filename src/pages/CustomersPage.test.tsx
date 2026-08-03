import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { toast } from 'sonner';
import CustomersPage from './CustomersPage';
import * as customersApi from '../api/customers.api';
import { useAuthStore } from '../stores/authStore';

const SUPERADMIN = { id: 'u1', name: 'Super', email: 'super@a.test', role: 'superadmin' as const };

function renderWithClient(ui: React.ReactElement, client: QueryClient = new QueryClient()) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const BASE_CUSTOMER = {
  id: '1',
  firstName: 'Alexander',
  lastName: 'Varghese',
  middleName: 'Reginald',
  givenName: 'Alexander Reginald',
  paxType: 'ADT' as const,
  dob: '01-Jan-1980',
  gender: 'M',
  phone: '555-0100',
  email: 'alex@example.com',
  verified: true,
  passport: {
    number: 'P1234567',
    issuingCountry: 'US',
    expiryDate: '2030-01-01',
    hasPhoto: true,
  },
};

describe('CustomersPage', () => {
  beforeEach(() => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({ customers: [], total: 0, page: 1, pageSize: 25 });
    // A superadmin by default so every pre-existing behavioral test below (which predates the
    // Export/Import permission gating) keeps exercising those buttons unimpeded. Tests targeting
    // the gating itself override this with their own useAuthStore.setState(...) before rendering.
    useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
  });

  it('lists a customer with every required column', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<CustomersPage />);

    expect(await screen.findByText('Varghese/Alexander Reginald')).toBeInTheDocument();
    expect(screen.getByText('Alexander Reginald')).toBeInTheDocument();
    expect(screen.getByText('Varghese')).toBeInTheDocument();
    // Stored as '01-Jan-1980', displayed as '01 Jan 1980' — the same 'DD Mon YYYY' every other
    // date in the app uses. The clipboard value stays the dash-stripped form (see below).
    expect(screen.getByText('01 Jan 1980')).toBeInTheDocument();
    expect(screen.getByText('ADT')).toBeInTheDocument();
    expect(screen.getByText('Male')).toBeInTheDocument();
    expect(screen.getByText('alex@example.com')).toBeInTheDocument();
    expect(screen.getByText('555-0100')).toBeInTheDocument();
    expect(screen.getByLabelText('Verified')).toBeInTheDocument();
  });

  it('shows skeleton rows while the first load is pending, not the empty state', () => {
    vi.mocked(customersApi.listCustomers).mockReturnValue(new Promise(() => {})); // never resolves
    renderWithClient(<CustomersPage />);
    expect(screen.getAllByTestId('table-skeleton-row').length).toBeGreaterThan(0);
    expect(screen.queryByText('No customers found.')).not.toBeInTheDocument();
  });

  it('truncates a long Ticketing Name and Email with an ellipsis and a full-text tooltip', async () => {
    const longTicketingCustomer = {
      ...BASE_CUSTOMER,
      lastName: 'VerylongLastNameIndeed',
      firstName: 'AVeryLongFirstNameToo',
      middleName: undefined,
      email: 'a.very.long.email.address.for.testing@example.com',
    };
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [longTicketingCustomer],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<CustomersPage />);

    const ticketingName = 'VerylongLastNameIndeed/AVeryLongFirstNameToo';
    const ticketingSpan = await screen.findByTitle(ticketingName);
    expect(ticketingSpan).toHaveClass('text-ellipsis');
    expect(ticketingSpan.style.maxWidth).toBe('25ch');

    const emailSpan = screen.getByTitle('a.very.long.email.address.for.testing@example.com');
    expect(emailSpan).toHaveClass('text-ellipsis');
    expect(emailSpan.style.maxWidth).toBe('30ch');
  });

  it('shows Female and Other gender badges', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [
        { ...BASE_CUSTOMER, id: '2', gender: 'F' },
        { ...BASE_CUSTOMER, id: '3', gender: 'U' },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<CustomersPage />);
    expect(await screen.findByText('Female')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('opens the View Passport popup from the list and shows passport details with working document buttons', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    vi.spyOn(customersApi, 'getPassportDownloadUrl').mockResolvedValue('https://signed.example.com/passport.jpg');
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderWithClient(<CustomersPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'View passport for Alexander Varghese' }));
    expect(await screen.findByText('P1234567')).toBeInTheDocument();
    expect(screen.getByText('US')).toBeInTheDocument();
    expect(screen.getByText('2030-01-01')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View document' }));
    await waitFor(() => {
      expect(customersApi.getPassportDownloadUrl).toHaveBeenCalledWith('1', false);
      expect(openSpy).toHaveBeenCalledWith('https://signed.example.com/passport.jpg', '_blank', 'noopener,noreferrer');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Download document' }));
    await waitFor(() => {
      expect(customersApi.getPassportDownloadUrl).toHaveBeenCalledWith('1', true);
    });
  });

  it('disables the passport view icon when a customer has no passport on file', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [{ ...BASE_CUSTOMER, passport: undefined }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<CustomersPage />);
    expect(await screen.findByRole('button', { name: 'View passport for Alexander Varghese' })).toBeDisabled();
  });

  it('shows a red X icon for an unverified customer', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [{ ...BASE_CUSTOMER, verified: false }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<CustomersPage />);
    expect(await screen.findByLabelText('Not verified')).toBeInTheDocument();
  });

  it('toggles verified via the inline button + confirm dialog', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [{ ...BASE_CUSTOMER, verified: false }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    vi.spyOn(customersApi, 'updateCustomer').mockResolvedValue({ id: '1' });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderWithClient(<CustomersPage />, client);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Toggle verified status for Alexander Varghese' })
    );
    expect(await screen.findByText('Mark Alexander Varghese as verified?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(customersApi.updateCustomer).toHaveBeenCalledWith('1', { verified: true });
    });
    // Confirms the customers list query is invalidated on success, so the table refreshes to
    // reflect the new verified state without a manual reload.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['customers', 'list'] });
    });
  });

  it('renders a read-only Verified icon (no toggle button) without edit permission', async () => {
    useAuthStore.setState({
      accessToken: 't',
      user: {
        id: 'u7',
        name: 'Edit-less Agent',
        email: 'agent-no-edit@a.test',
        role: 'agent' as const,
        permissions: {
          bookings: {
            create: false,
            edit: false,
            delete: false,
            createAdjustment: false,
            viewAll: false,
            import: false,
            export: false,
            sendInvoice: false,
          },
          customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
          groups: { createShared: false },
          data: { viewReports: false },
          enquiries: { sendQuote: false, edit: false, delete: false },
        },
      },
    });
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<CustomersPage />);

    await screen.findByText('alex@example.com');
    expect(
      screen.queryByRole('button', { name: 'Toggle verified status for Alexander Varghese' })
    ).not.toBeInTheDocument();
    // The cell must still degrade to the read-only icon rather than rendering nothing —
    // BASE_CUSTOMER is verified: true.
    expect(screen.getByLabelText('Verified')).toBeInTheDocument();
  });

  it('copies the Ticketing Name, Email, and Phone values to the clipboard', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithClient(<CustomersPage />);
    await screen.findByText('alex@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Copy Varghese/Alexander Reginald' }));
    expect(writeText).toHaveBeenLastCalledWith('Varghese/Alexander Reginald');

    await userEvent.click(screen.getByRole('button', { name: 'Copy alex@example.com' }));
    expect(writeText).toHaveBeenLastCalledWith('alex@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Copy 555-0100' }));
    expect(writeText).toHaveBeenLastCalledWith('555-0100');

    expect(writeText).toHaveBeenCalledTimes(3);
  });

  it('copies the Date of Birth to the clipboard with dashes stripped (DDMMMYYYY)', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithClient(<CustomersPage />);
    await screen.findByText('01 Jan 1980');

    await userEvent.click(screen.getByRole('button', { name: 'Copy 01Jan1980' }));
    expect(writeText).toHaveBeenLastCalledWith('01Jan1980');
  });

  it('displays a 10-digit phone as (832)-555-1234 and copies the bare digits', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [{ ...BASE_CUSTOMER, phone: '8325551234' }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithClient(<CustomersPage />);

    expect(await screen.findByText('(832)-555-1234')).toBeInTheDocument();

    // CopyableText's copy button takes its accessible name from the COPIED value (see the
    // Date of Birth precedent above, which is "Copy 01Jan1980" — the copyValue, not the
    // displayed "01 Jan 1980") — so the button here is named for the bare digits.
    await userEvent.click(screen.getByRole('button', { name: 'Copy 8325551234' }));
    // The clipboard gets the same bare digits, which paste cleanly into Sabre or a dialer.
    expect(writeText).toHaveBeenLastCalledWith('8325551234');
  });

  it('debounces the search box into a server-side query param', async () => {
    renderWithClient(<CustomersPage />);
    await userEvent.type(screen.getByLabelText('Search customers'), 'Var');

    await waitFor(() => {
      const lastCall = vi.mocked(customersApi.listCustomers).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ q: 'Var' });
    });
  });

  it('filters by status via the faceted filter', async () => {
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: /Status/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Verified' }));

    await waitFor(() => {
      const lastCall = vi.mocked(customersApi.listCustomers).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ status: 'verified' });
    });
  });

  it('sorts by Given Name when its column header is clicked', async () => {
    renderWithClient(<CustomersPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Given Name/ }));

    await waitFor(() => {
      const lastCall = vi.mocked(customersApi.listCustomers).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ sortBy: 'givenName', sortDir: 'asc' });
    });
  });

  it('sorts by Ticketing Name when its column header is clicked, mapping to the lastName sortBy', async () => {
    renderWithClient(<CustomersPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Ticketing Name/ }));

    await waitFor(() => {
      const lastCall = vi.mocked(customersApi.listCustomers).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ sortBy: 'lastName', sortDir: 'asc' });
    });
  });

  it('changes rows per page via the pagination footer', async () => {
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    await userEvent.click(await screen.findByRole('option', { name: '50' }));

    await waitFor(() => {
      const lastCall = vi.mocked(customersApi.listCustomers).mock.calls.slice(-1)[0]?.[0];
      expect(lastCall).toMatchObject({ pageSize: 50 });
    });
  });

  it('paginates via numbered page links', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockImplementation((params = {}) =>
      Promise.resolve({
        customers: [{ ...BASE_CUSTOMER, id: String(params.page ?? 1), firstName: `Page${params.page ?? 1}` }],
        total: 100,
        page: params.page ?? 1,
        pageSize: 25,
      })
    );
    renderWithClient(<CustomersPage />);

    expect(await screen.findByText('Varghese/Page1 Reginald')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: '2' }));
    expect(await screen.findByText('Varghese/Page2 Reginald')).toBeInTheDocument();
  });

  it('creates a new customer via the Add Customer dialog', async () => {
    vi.spyOn(customersApi, 'createCustomer').mockResolvedValue({ id: '2' });
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Customer' }));

    await userEvent.type(screen.getByLabelText('First name'), 'New');
    await userEvent.type(screen.getByLabelText('Middle name'), 'Middleton');
    await userEvent.type(screen.getByLabelText('Last name'), 'Customer');
    await userEvent.type(screen.getByLabelText('Date of birth'), '1990-05-15');
    await userEvent.type(screen.getByLabelText('Phone'), '555-0199');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(customersApi.createCustomer).toHaveBeenCalled();
      const [firstCallArgs] = vi.mocked(customersApi.createCustomer).mock.calls[0];
      expect(firstCallArgs).toEqual(
        expect.objectContaining({
          firstName: 'New',
          middleName: 'Middleton',
          lastName: 'Customer',
          dob: '15-May-1990',
          // The field masks '5550199' (7 digits) to '(555)-019-9' on screen and submits that.
          // The backend's normalizePhone reduces it to bare digits '5550199' on write.
          phone: '(555)-019-9',
        })
      );
    });
  });

  it('lets the user pick a Gender in the Add Customer dialog', async () => {
    vi.spyOn(customersApi, 'createCustomer').mockResolvedValue({ id: '2' });
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Customer' }));

    await userEvent.click(screen.getByRole('combobox', { name: 'Gender' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Female' }));

    await userEvent.type(screen.getByLabelText('First name'), 'New');
    await userEvent.type(screen.getByLabelText('Last name'), 'Customer');
    await userEvent.type(screen.getByLabelText('Date of birth'), '1990-05-15');
    await userEvent.type(screen.getByLabelText('Phone'), '555-0199');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(customersApi.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ gender: 'F' }));
    });
  });

  it('the Add Customer dialog disables the passport view button (no customer id yet)', async () => {
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Customer' }));
    expect(screen.getByRole('button', { name: 'View passport document' })).toBeDisabled();
    // Downloading belongs to the read-only ViewPassportDialog, not to the upload form.
    expect(screen.queryByRole('button', { name: 'Download passport document' })).not.toBeInTheDocument();
  });

  it('rejects a partially filled passport section', async () => {
    const createSpy = vi.spyOn(customersApi, 'createCustomer').mockResolvedValue({ id: '2' });
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Customer' }));

    await userEvent.type(screen.getByLabelText('First name'), 'New');
    await userEvent.type(screen.getByLabelText('Last name'), 'Customer');
    await userEvent.type(screen.getByLabelText('Date of birth'), '1990-05-15');
    await userEvent.type(screen.getByLabelText('Phone'), '555-0199');
    await userEvent.type(screen.getByLabelText('Passport #'), 'P0000000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Passport number, issuing country, and expiry date are all required together.')
    ).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('uploads a passport file then submits the resulting key when creating a customer', async () => {
    vi.spyOn(customersApi, 'createCustomer').mockResolvedValue({ id: '2' });
    vi.spyOn(customersApi, 'uploadPassportFile').mockResolvedValue('passports/new-key.jpg');
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Customer' }));

    await userEvent.type(screen.getByLabelText('First name'), 'New');
    await userEvent.type(screen.getByLabelText('Last name'), 'Customer');
    await userEvent.type(screen.getByLabelText('Date of birth'), '1990-05-15');
    await userEvent.type(screen.getByLabelText('Phone'), '555-0199');
    await userEvent.type(screen.getByLabelText('Passport #'), 'P0000000');
    await userEvent.type(screen.getByLabelText('Issuing Country'), 'US');
    await userEvent.type(screen.getByLabelText('Expiry Date'), '2035-01-01');
    const file = new File(['dummy'], 'passport.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Upload passport'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(customersApi.uploadPassportFile).toHaveBeenCalledWith(file);
      expect(customersApi.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          passport: {
            number: 'P0000000',
            issuingCountry: 'US',
            expiryDate: '2035-01-01',
            photoS3Key: 'passports/new-key.jpg',
          },
        })
      );
    });
  });

  it('edits an existing customer via the row actions menu', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    vi.spyOn(customersApi, 'updateCustomer').mockResolvedValue({ id: '1' });
    renderWithClient(<CustomersPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Row actions for Alexander Varghese' }));
    await userEvent.click(await screen.findByText('Edit'));
    expect(await screen.findByText('Edit customer')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Alexander');

    await userEvent.clear(screen.getByLabelText('First name'));
    await userEvent.type(screen.getByLabelText('First name'), 'Updated');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(customersApi.updateCustomer).toHaveBeenCalledWith('1', expect.objectContaining({ firstName: 'Updated' }));
    });
  });

  it('enables passport view/download in the Edit dialog when the customer already has a photo on file', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<CustomersPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Row actions for Alexander Varghese' }));
    await userEvent.click(await screen.findByText('Edit'));
    expect(await screen.findByLabelText('Passport #')).toHaveValue('P1234567');
    expect(screen.getByRole('button', { name: 'View passport document' })).toBeEnabled();
  });

  it('deletes a single customer via the row actions menu', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    vi.spyOn(customersApi, 'bulkDeleteCustomers').mockResolvedValue({ deletedCount: 1 });
    renderWithClient(<CustomersPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Row actions for Alexander Varghese' }));
    await userEvent.click(await screen.findByText('Delete'));
    expect(await screen.findByText('Delete customer?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(customersApi.bulkDeleteCustomers).toHaveBeenCalledWith(['1']);
    });
  });

  it('selects multiple rows and bulk deletes them', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER, { ...BASE_CUSTOMER, id: '2', firstName: 'Bob', lastName: 'Second' }],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    vi.spyOn(customersApi, 'bulkDeleteCustomers').mockResolvedValue({ deletedCount: 2 });
    renderWithClient(<CustomersPage />);

    await userEvent.click(await screen.findByLabelText('Select Alexander Varghese'));
    await userEvent.click(await screen.findByLabelText('Select Bob Second'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete (2)' }));
    expect(await screen.findByText('Delete 2 customers?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(customersApi.bulkDeleteCustomers).toHaveBeenCalledWith(expect.arrayContaining(['1', '2']));
    });
  });

  it('toggles column visibility via the View dropdown', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderWithClient(<CustomersPage />);
    await screen.findByText('alex@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Email' }));

    await waitFor(() => {
      expect(screen.queryByText('alex@example.com')).not.toBeInTheDocument();
    });
  });

  it('imports customers via the Import Customers dialog', async () => {
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Import Customers' }));
    expect(await screen.findByLabelText('Customer import file')).toBeInTheDocument();
  });

  it('exports customers via the Export dialog', async () => {
    vi.spyOn(customersApi, 'exportCustomers').mockResolvedValue(undefined);
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('Export customers')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(customersApi.exportCustomers).toHaveBeenCalled());
  });

  it('shows an error in the export dialog when export fails', async () => {
    vi.spyOn(customersApi, 'exportCustomers').mockRejectedValueOnce(new Error('network down'));
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByText('Export failed. Check your connection and try again.')).toBeInTheDocument();
  });

  it('toasts "Customer created" after a successful create', async () => {
    vi.spyOn(customersApi, 'createCustomer').mockResolvedValue({ id: '2' });
    const successSpy = vi.spyOn(toast, 'success');
    renderWithClient(<CustomersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Customer' }));

    await userEvent.type(screen.getByLabelText('First name'), 'New');
    await userEvent.type(screen.getByLabelText('Last name'), 'Customer');
    await userEvent.type(screen.getByLabelText('Date of birth'), '1990-05-15');
    await userEvent.type(screen.getByLabelText('Phone'), '555-0199');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Customer created'));
    successSpy.mockRestore();
  });

  it('toasts "Customer deleted" after a single-row delete', async () => {
    vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
      customers: [BASE_CUSTOMER],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    vi.spyOn(customersApi, 'bulkDeleteCustomers').mockResolvedValue({ deletedCount: 1 });
    const successSpy = vi.spyOn(toast, 'success');
    renderWithClient(<CustomersPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Row actions for Alexander Varghese' }));
    await userEvent.click(await screen.findByText('Delete'));
    expect(await screen.findByText('Delete customer?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Customer deleted'));
    successSpy.mockRestore();
  });

  describe('Export/Import permission gating', () => {
    const ADMIN_NO_PERMS = {
      id: 'u2',
      name: 'Plain Admin',
      email: 'admin@a.test',
      role: 'admin' as const,
      permissions: {
        bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
        customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
        groups: { createShared: false },
        data: { viewReports: false },
        enquiries: { sendQuote: false, edit: false, delete: false },
      },
    };
    const ADMIN_WITH_EXPORT = {
      ...ADMIN_NO_PERMS,
      id: 'u3',
      permissions: {
        ...ADMIN_NO_PERMS.permissions,
        customers: { ...ADMIN_NO_PERMS.permissions.customers, export: true },
      },
    };

    it('a superadmin sees both Export and Import Customers buttons', async () => {
      useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
      renderWithClient(<CustomersPage />);
      expect(await screen.findByRole('button', { name: 'Export' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Import Customers' })).toBeInTheDocument();
    });

    it('an admin without customers.import/export permissions sees neither button', async () => {
      useAuthStore.setState({ accessToken: 't', user: ADMIN_NO_PERMS });
      renderWithClient(<CustomersPage />);
      await screen.findByRole('button', { name: 'Add Customer' });
      expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Import Customers' })).not.toBeInTheDocument();
    });

    it('an admin with customers.export granted sees Export but not Import', async () => {
      useAuthStore.setState({ accessToken: 't', user: ADMIN_WITH_EXPORT });
      renderWithClient(<CustomersPage />);
      expect(await screen.findByRole('button', { name: 'Export' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Import Customers' })).not.toBeInTheDocument();
    });
  });

  describe('Create/Edit/Delete permission gating', () => {
    const AGENT_NO_PERMS = {
      id: 'u4',
      name: 'Powerless Agent',
      email: 'agent-none@a.test',
      role: 'agent' as const,
      permissions: {
        bookings: { create: false, edit: false, delete: false, createAdjustment: false, viewAll: false, import: false, export: false, sendInvoice: false },
        customers: { create: false, edit: false, delete: false, viewPassport: false, import: false, export: false },
        groups: { createShared: false },
        data: { viewReports: false },
        enquiries: { sendQuote: false, edit: false, delete: false },
      },
    };
    const AGENT_WITH_CREATE = {
      ...AGENT_NO_PERMS,
      id: 'u5',
      permissions: { ...AGENT_NO_PERMS.permissions, customers: { ...AGENT_NO_PERMS.permissions.customers, create: true } },
    };
    const AGENT_WITH_DELETE = {
      ...AGENT_NO_PERMS,
      id: 'u6',
      permissions: { ...AGENT_NO_PERMS.permissions, customers: { ...AGENT_NO_PERMS.permissions.customers, delete: true } },
    };
    const AGENT_WITH_EDIT = {
      ...AGENT_NO_PERMS,
      id: 'u7',
      permissions: { ...AGENT_NO_PERMS.permissions, customers: { ...AGENT_NO_PERMS.permissions.customers, edit: true } },
    };

    it('a superadmin sees the Add Customer button', async () => {
      useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
      renderWithClient(<CustomersPage />);
      expect(await screen.findByRole('button', { name: 'Add Customer' })).toBeInTheDocument();
    });

    it('an agent without customers.create does not see the Add Customer button', async () => {
      useAuthStore.setState({ accessToken: 't', user: AGENT_NO_PERMS });
      renderWithClient(<CustomersPage />);
      await waitFor(() => expect(customersApi.listCustomers).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: 'Add Customer' })).not.toBeInTheDocument();
    });

    it('an agent with customers.create sees the Add Customer button', async () => {
      useAuthStore.setState({ accessToken: 't', user: AGENT_WITH_CREATE });
      renderWithClient(<CustomersPage />);
      expect(await screen.findByRole('button', { name: 'Add Customer' })).toBeInTheDocument();
    });

    describe('bulk Delete (N) button', () => {
      beforeEach(() => {
        vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
          customers: [BASE_CUSTOMER, { ...BASE_CUSTOMER, id: '2', firstName: 'Bob', lastName: 'Second' }],
          total: 2,
          page: 1,
          pageSize: 25,
        });
      });

      it('a superadmin sees Delete (N) once rows are selected', async () => {
        useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
        renderWithClient(<CustomersPage />);
        await userEvent.click(await screen.findByLabelText('Select Alexander Varghese'));
        expect(await screen.findByRole('button', { name: 'Delete (1)' })).toBeInTheDocument();
      });

      it('an agent without customers.delete never sees Delete (N), even with rows selected', async () => {
        useAuthStore.setState({ accessToken: 't', user: AGENT_NO_PERMS });
        renderWithClient(<CustomersPage />);
        await userEvent.click(await screen.findByLabelText('Select Alexander Varghese'));
        expect(screen.queryByRole('button', { name: /Delete \(/ })).not.toBeInTheDocument();
      });

      it('an agent with customers.delete sees Delete (N) once rows are selected', async () => {
        useAuthStore.setState({ accessToken: 't', user: AGENT_WITH_DELETE });
        renderWithClient(<CustomersPage />);
        await userEvent.click(await screen.findByLabelText('Select Alexander Varghese'));
        expect(await screen.findByRole('button', { name: 'Delete (1)' })).toBeInTheDocument();
      });
    });

    describe('row actions (customer-row-actions.tsx)', () => {
      beforeEach(() => {
        vi.spyOn(customersApi, 'listCustomers').mockResolvedValue({
          customers: [BASE_CUSTOMER],
          total: 1,
          page: 1,
          pageSize: 25,
        });
      });

      it('a superadmin sees both Edit and Delete in the row actions menu', async () => {
        useAuthStore.setState({ accessToken: 't', user: SUPERADMIN });
        renderWithClient(<CustomersPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Row actions for Alexander Varghese' }));
        expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
      });

      // Neither permission granted — the row-actions trigger itself must not render, not just an
      // empty menu behind it (customer-row-actions.tsx returns null in that case).
      it('an agent with neither customers.edit nor customers.delete sees no row actions trigger at all', async () => {
        useAuthStore.setState({ accessToken: 't', user: AGENT_NO_PERMS });
        renderWithClient(<CustomersPage />);
        await screen.findByText('alex@example.com');
        expect(screen.queryByRole('button', { name: 'Row actions for Alexander Varghese' })).not.toBeInTheDocument();
      });

      it('an agent with only customers.edit sees Edit but not Delete in the menu', async () => {
        useAuthStore.setState({ accessToken: 't', user: AGENT_WITH_EDIT });
        renderWithClient(<CustomersPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Row actions for Alexander Varghese' }));
        expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
      });

      it('an agent with only customers.delete sees Delete but not Edit in the menu', async () => {
        useAuthStore.setState({ accessToken: 't', user: AGENT_WITH_DELETE });
        renderWithClient(<CustomersPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Row actions for Alexander Varghese' }));
        expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
      });
    });
  });
});
