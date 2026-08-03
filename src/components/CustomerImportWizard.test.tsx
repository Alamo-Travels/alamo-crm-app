import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import * as XLSX from 'xlsx';
import CustomerImportWizard from './CustomerImportWizard';
import * as customersApi from '../api/customers.api';

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomerImportWizard />
    </QueryClientProvider>
  );
}

function buildTestFile(givenName = 'Alexander Reginald'): File {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Given Name', 'Last Name', 'Phone'],
    [givenName, 'Varghese', '555-0100'],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([arrayBuffer], 'customers.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function mapColumn(triggerName: string, optionName: string) {
  await userEvent.click(screen.getByRole('combobox', { name: triggerName }));
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

describe('CustomerImportWizard', () => {
  it('parses a file, maps columns, and previews via a dry run', async () => {
    vi.spyOn(customersApi, 'importCustomers').mockResolvedValueOnce([{ index: 0, status: 'would_import' }]);
    renderWizard();

    await userEvent.upload(screen.getByLabelText('Customer import file'), buildTestFile());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Given Name' })).toBeInTheDocument());

    await mapColumn('Map Given Name', 'Given Name');
    await mapColumn('Map Last Name', 'Last Name');
    await mapColumn('Map Phone', 'Phone');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      expect(customersApi.importCustomers).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            firstName: 'Alexander',
            lastName: 'Varghese',
            middleName: 'Reginald',
            phone: '555-0100',
          }),
        ],
        true
      );
    });
    expect(await screen.findByText(/1 of 1 row\(s\) ready to import\./)).toBeInTheDocument();
  });

  it('splits a single-word Given Name into firstName only, with no middleName', async () => {
    vi.spyOn(customersApi, 'importCustomers').mockResolvedValueOnce([{ index: 0, status: 'would_import' }]);
    renderWizard();

    await userEvent.upload(screen.getByLabelText('Customer import file'), buildTestFile('Alexander'));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Given Name' })).toBeInTheDocument());

    await mapColumn('Map Given Name', 'Given Name');
    await mapColumn('Map Last Name', 'Last Name');
    await mapColumn('Map Phone', 'Phone');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      expect(customersApi.importCustomers).toHaveBeenCalledWith(
        [expect.objectContaining({ firstName: 'Alexander', middleName: undefined, lastName: 'Varghese' })],
        true
      );
    });
  });

  it('lets the user mark a flagged duplicate row to import anyway, then commits', async () => {
    vi.spyOn(customersApi, 'importCustomers')
      .mockResolvedValueOnce([{ index: 0, status: 'flagged_duplicate', reason: 'Matches existing customer x' }])
      .mockResolvedValueOnce([{ index: 0, status: 'imported' }]);
    renderWizard();

    await userEvent.upload(screen.getByLabelText('Customer import file'), buildTestFile());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Given Name' })).toBeInTheDocument());
    await mapColumn('Map Given Name', 'Given Name');
    await mapColumn('Map Last Name', 'Last Name');
    await mapColumn('Map Phone', 'Phone');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await screen.findByText('flagged_duplicate');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Import row 1 anyway' }));
    await userEvent.click(screen.getByRole('button', { name: 'Commit Import' }));

    await waitFor(() => {
      const [rows, dryRun] = vi.mocked(customersApi.importCustomers).mock.calls[1];
      expect(dryRun).toBe(false);
      expect(rows[0].forceImport).toBe(true);
    });
    expect(await screen.findByText(/1 of 1 row\(s\) imported\./)).toBeInTheDocument();
  });

  it('invalidates the customers list cache after a successful commit (so new rows show without a refresh)', async () => {
    vi.spyOn(customersApi, 'importCustomers')
      .mockResolvedValueOnce([{ index: 0, status: 'would_import' }])
      .mockResolvedValueOnce([{ index: 0, status: 'imported' }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <CustomerImportWizard />
      </QueryClientProvider>
    );

    await userEvent.upload(screen.getByLabelText('Customer import file'), buildTestFile());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Given Name' })).toBeInTheDocument());
    await mapColumn('Map Given Name', 'Given Name');
    await mapColumn('Map Last Name', 'Last Name');
    await mapColumn('Map Phone', 'Phone');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText(/1 of 1 row\(s\) ready to import\./);
    await userEvent.click(screen.getByRole('button', { name: 'Commit Import' }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['customers'] }));
  });

  it('parses "TRUE"/"FALSE" (and other common spellings) in the Verified column as real booleans', async () => {
    vi.spyOn(customersApi, 'importCustomers').mockResolvedValueOnce([
      { index: 0, status: 'would_import' },
      { index: 1, status: 'would_import' },
      { index: 2, status: 'would_import' },
    ]);
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Given Name', 'Last Name', 'Phone', 'Verified'],
      ['Alice', 'First', '555-0001', 'TRUE'],
      ['Bob', 'Second', '555-0002', 'FALSE'],
      ['Carol', 'Third', '555-0003', 'yes'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([arrayBuffer], 'customers.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    renderWizard();
    await userEvent.upload(screen.getByLabelText('Customer import file'), file);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Given Name' })).toBeInTheDocument());

    await mapColumn('Map Given Name', 'Given Name');
    await mapColumn('Map Last Name', 'Last Name');
    await mapColumn('Map Phone', 'Phone');
    await mapColumn('Map Verified', 'Verified');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      const [rows] = vi.mocked(customersApi.importCustomers).mock.calls[0];
      expect(rows[0].verified).toBe(true);
      expect(rows[1].verified).toBe(false);
      expect(rows[2].verified).toBe(true);
    });
  });

  it('shows an error and re-enables Preview when the import request fails', async () => {
    vi.spyOn(customersApi, 'importCustomers').mockRejectedValueOnce(new Error('network down'));
    renderWizard();

    await userEvent.upload(screen.getByLabelText('Customer import file'), buildTestFile());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Given Name' })).toBeInTheDocument());
    await mapColumn('Map Given Name', 'Given Name');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(
      await screen.findByText('Import request failed. Check your connection and try again.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
  });
});
