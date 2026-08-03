import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import * as XLSX from 'xlsx';
import BookingImportWizard from './BookingImportWizard';
import * as bookingsApi from '../api/bookings.api';

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BookingImportWizard />
    </QueryClientProvider>
  );
}

function buildTestFile(): File {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Date', 'Invoice', 'Name of PAX', 'Amount', 'PNR', 'Flight', 'Dep City', 'Arr City', 'Dep Date', 'Arr Date'],
    ['2026-05-04', '0000150', 'JOSEPH/SHINY S', '2400.02', 'GUDBFX', 'QR', 'DXB', 'COK', '2026-05-08', '2026-05-28'],
    ['2026-05-14', 'REISSUE', 'ANILKUMAR SATHI/VISHNU', '50', 'DJMUFL', 'EK', 'DXB', 'COK', '2026-05-26', '2026-07-28'],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([arrayBuffer], 'bookings.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function selectOption(triggerName: string, optionName: string) {
  await userEvent.click(screen.getByRole('combobox', { name: triggerName }));
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

async function mapAllColumns() {
  await selectOption('Map Booking Date', 'Date');
  await selectOption('Map Invoice', 'Invoice');
  await selectOption('Map Name of PAX', 'Name of PAX');
  await selectOption('Map Amount', 'Amount');
  await selectOption('Map PNR', 'PNR');
  await selectOption('Map Flight', 'Flight');
  await selectOption('Map Dep City', 'Dep City');
  await selectOption('Map Arr City', 'Arr City');
  await selectOption('Map Dep Date', 'Dep Date');
  await selectOption('Map Arr Date', 'Arr Date');
}

describe('BookingImportWizard', () => {
  it('derives bookingType New for a numeric invoice and Reissue for REISSUE text, then previews', async () => {
    vi.spyOn(bookingsApi, 'importBookings').mockResolvedValueOnce([
      { index: 0, status: 'would_import' },
      { index: 1, status: 'would_import' },
    ]);
    renderWizard();

    await userEvent.upload(screen.getByLabelText('Booking import file'), buildTestFile());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await mapAllColumns();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      const [rows, paymentDefault, dryRun] = vi.mocked(bookingsApi.importBookings).mock.calls[0];
      expect(rows[0]).toEqual(
        expect.objectContaining({ bookingType: 'New', invoiceNumber: '0000150', passengerName: 'JOSEPH/SHINY S' })
      );
      expect(rows[1]).toEqual(
        expect.objectContaining({
          bookingType: 'Reissue',
          invoiceNumber: undefined,
          passengerName: 'ANILKUMAR SATHI/VISHNU',
        })
      );
      expect(paymentDefault).toEqual({ status: 'paid', type: 'card' });
      expect(dryRun).toBe(true);
    });
    expect(await screen.findByText(/2 of 2 row\(s\) ready to import\./)).toBeInTheDocument();
  });

  it('sends the chosen payment default and commits on dryRun false', async () => {
    vi.spyOn(bookingsApi, 'importBookings')
      .mockResolvedValueOnce([
        { index: 0, status: 'would_import' },
        { index: 1, status: 'would_import' },
      ])
      .mockResolvedValueOnce([
        { index: 0, status: 'imported' },
        { index: 1, status: 'needs_manual_linking' },
      ]);
    renderWizard();

    await userEvent.upload(screen.getByLabelText('Booking import file'), buildTestFile());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await mapAllColumns();
    await selectOption('Import payment type', 'Cash');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText(/2 of 2 row\(s\) ready to import\./);

    await userEvent.click(screen.getByRole('button', { name: 'Commit Import' }));

    await waitFor(() => {
      const [, paymentDefault, dryRun] = vi.mocked(bookingsApi.importBookings).mock.calls[1];
      expect(paymentDefault).toEqual({ status: 'paid', type: 'cash' });
      expect(dryRun).toBe(false);
    });
    expect(await screen.findByText('needs_manual_linking')).toBeInTheDocument();
    expect(await screen.findByText(/1 of 2 row\(s\) imported\./)).toBeInTheDocument();
  });

  it('invalidates the bookings list cache after a successful commit (so new rows show without a refresh)', async () => {
    vi.spyOn(bookingsApi, 'importBookings')
      .mockResolvedValueOnce([
        { index: 0, status: 'would_import' },
        { index: 1, status: 'would_import' },
      ])
      .mockResolvedValueOnce([
        { index: 0, status: 'imported' },
        { index: 1, status: 'imported' },
      ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <BookingImportWizard />
      </QueryClientProvider>
    );

    await userEvent.upload(screen.getByLabelText('Booking import file'), buildTestFile());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await mapAllColumns();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText(/2 of 2 row\(s\) ready to import\./);
    await userEvent.click(screen.getByRole('button', { name: 'Commit Import' }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bookings'] }));
  });

  it('maps a Pending Amount column and sends it per-row when importing as pending', async () => {
    vi.spyOn(bookingsApi, 'importBookings').mockResolvedValueOnce([{ index: 0, status: 'would_import' }]);
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Date', 'Invoice', 'Name of PAX', 'Amount', 'Pending Amount'],
      ['2026-05-04', '0000150', 'JOSEPH/SHINY S', '500', '150'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([arrayBuffer], 'pending-amount.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    renderWizard();
    await userEvent.upload(screen.getByLabelText('Booking import file'), file);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await selectOption('Map Booking Date', 'Date');
    await selectOption('Map Invoice', 'Invoice');
    await selectOption('Map Name of PAX', 'Name of PAX');
    await selectOption('Map Amount', 'Amount');
    await selectOption('Map Pending Amount', 'Pending Amount');
    await selectOption('Import payment status', 'Pending');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      const [rows] = vi.mocked(bookingsApi.importBookings).mock.calls[0];
      expect(rows[0]).toEqual(expect.objectContaining({ amount: 500, pendingAmount: 150 }));
    });
  });

  it('maps per-row Payment Status/Type columns and sends the raw cell text per-row', async () => {
    vi.spyOn(bookingsApi, 'importBookings').mockResolvedValueOnce([
      { index: 0, status: 'would_import' },
      { index: 1, status: 'would_import' },
    ]);
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Date', 'Invoice', 'Name of PAX', 'Amount', 'Pay Status', 'Pay Type'],
      ['2026-05-04', '0000150', 'MIX/ANN', '300', 'Paid', 'Card'],
      ['2026-05-04', '0000150', 'MIX/BOB', '400', 'Pending', 'Cash'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([arrayBuffer], 'per-row-payment.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    renderWizard();
    await userEvent.upload(screen.getByLabelText('Booking import file'), file);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await selectOption('Map Booking Date', 'Date');
    await selectOption('Map Invoice', 'Invoice');
    await selectOption('Map Name of PAX', 'Name of PAX');
    await selectOption('Map Amount', 'Amount');
    await selectOption('Map Payment Status', 'Pay Status');
    await selectOption('Map Payment Type', 'Pay Type');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      const [rows] = vi.mocked(bookingsApi.importBookings).mock.calls[0];
      expect(rows[0]).toEqual(expect.objectContaining({ paymentStatus: 'Paid', paymentType: 'Card' }));
      expect(rows[1]).toEqual(expect.objectContaining({ paymentStatus: 'Pending', paymentType: 'Cash' }));
    });
  });

  it('maps a Voided column and sends it as a real boolean', async () => {
    vi.spyOn(bookingsApi, 'importBookings').mockResolvedValueOnce([{ index: 0, status: 'would_import' }]);
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Date', 'Invoice', 'Name of PAX', 'Amount', 'Voided'],
      ['2026-05-04', 'VOID-IMPORT-UI', 'JOSEPH/SHINY S', '0', 'TRUE'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([arrayBuffer], 'voided.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    renderWizard();
    await userEvent.upload(screen.getByLabelText('Booking import file'), file);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await selectOption('Map Booking Date', 'Date');
    await selectOption('Map Invoice', 'Invoice');
    await selectOption('Map Name of PAX', 'Name of PAX');
    await selectOption('Map Amount', 'Amount');
    await selectOption('Map Voided', 'Voided');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      const [rows] = vi.mocked(bookingsApi.importBookings).mock.calls[0];
      expect(rows[0]).toEqual(expect.objectContaining({ voided: true }));
    });
  });

  it('imports a voided row with only Booking Date and Invoice mapped (PNR/Flight/etc left blank)', async () => {
    vi.spyOn(bookingsApi, 'importBookings').mockResolvedValueOnce([{ index: 0, status: 'would_import' }]);
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Date', 'Invoice', 'Name of PAX', 'Amount', 'Remark'],
      ['2026-05-04', 'VOID-001', 'JOSEPH/SHINY S', '0', 'VOID'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([arrayBuffer], 'void.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    renderWizard();
    await userEvent.upload(screen.getByLabelText('Booking import file'), file);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await selectOption('Map Booking Date', 'Date');
    await selectOption('Map Invoice', 'Invoice');
    await selectOption('Map Name of PAX', 'Name of PAX');
    await selectOption('Map Amount', 'Amount');
    await selectOption('Map Remark', 'Remark');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      const [rows] = vi.mocked(bookingsApi.importBookings).mock.calls[0];
      expect(rows[0]).toEqual(
        expect.objectContaining({
          bookingType: 'New',
          invoiceNumber: 'VOID-001',
          remark: 'VOID',
          pnr: undefined,
          airlineCode: undefined,
          arrCity: undefined,
          depDate: undefined,
          arrDate: undefined,
        })
      );
    });
  });

  it('treats empty, "null", and "--" Amount cells as 0', async () => {
    vi.spyOn(bookingsApi, 'importBookings').mockResolvedValueOnce([
      { index: 0, status: 'would_import' },
      { index: 1, status: 'would_import' },
      { index: 2, status: 'would_import' },
    ]);
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Date', 'Invoice', 'Name of PAX', 'Amount'],
      ['2026-05-04', 'INV-1', 'A/B', ''],
      ['2026-05-04', 'INV-2', 'C/D', 'null'],
      ['2026-05-04', 'INV-3', 'E/F', '--'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([arrayBuffer], 'blank-amounts.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    renderWizard();
    await userEvent.upload(screen.getByLabelText('Booking import file'), file);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await selectOption('Map Booking Date', 'Date');
    await selectOption('Map Invoice', 'Invoice');
    await selectOption('Map Name of PAX', 'Name of PAX');
    await selectOption('Map Amount', 'Amount');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      const [rows] = vi.mocked(bookingsApi.importBookings).mock.calls[0];
      expect(rows[0].amount).toBe(0);
      expect(rows[1].amount).toBe(0);
      expect(rows[2].amount).toBe(0);
    });
  });

  it('reports a flagged_duplicate row instead of silently dropping it, in the dry-run preview', async () => {
    vi.spyOn(bookingsApi, 'importBookings').mockResolvedValueOnce([
      { index: 0, status: 'flagged_duplicate', reason: 'John Smith is already on invoice 000005' },
      { index: 1, status: 'would_import' },
    ]);
    renderWizard();

    await userEvent.upload(screen.getByLabelText('Booking import file'), buildTestFile());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await mapAllColumns();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText(/already on invoice 000005/i)).toBeInTheDocument();
    expect(screen.getByText('Already imported')).toBeInTheDocument();
    expect(await screen.findByText(/1 of 2 row\(s\) ready to import\./)).toBeInTheDocument();
  });

  it('shows an error and re-enables Preview when the import request fails', async () => {
    vi.spyOn(bookingsApi, 'importBookings').mockRejectedValueOnce(new Error('network down'));
    renderWizard();

    await userEvent.upload(screen.getByLabelText('Booking import file'), buildTestFile());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Map Booking Date' })).toBeInTheDocument());
    await selectOption('Map Booking Date', 'Date');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(
      await screen.findByText('Import request failed. Check your connection and try again.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
  });
});
