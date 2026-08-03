import { ChangeEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parseXlsxFile } from '../utils/xlsxParse';
import ColumnMapper, { ColumnMapping, TargetField } from './ColumnMapper';
import { importBookings, ImportBookingRow, ImportBookingResult, PaymentDefault } from '../api/bookings.api';

const TARGET_FIELDS: TargetField[] = [
  { key: 'bookingDate', label: 'Booking Date', required: true },
  { key: 'invoiceNumber', label: 'Invoice', required: true },
  { key: 'passengerName', label: 'Name of PAX', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'voided', label: 'Voided' },
  { key: 'pnr', label: 'PNR' },
  { key: 'airlineCode', label: 'Flight' },
  { key: 'depCity', label: 'Dep City' },
  { key: 'arrCity', label: 'Arr City' },
  { key: 'depDate', label: 'Dep Date' },
  { key: 'arrDate', label: 'Arr Date' },
  { key: 'remark', label: 'Remark' },
  { key: 'pendingAmount', label: 'Pending Amount' },
  { key: 'paymentStatus', label: 'Payment Status' },
  { key: 'paymentType', label: 'Payment Type' },
];

const BLANK_AMOUNT_VALUES = new Set(['', 'null', '--']);
const TRUTHY_VOIDED_VALUES = new Set(['true', 'yes', 'y', '1', 't']);

const ISSUE_STATUS_LABELS: Partial<Record<ImportBookingResult['status'], string>> = {
  flagged_duplicate: 'Already imported',
};

function issueStatusLabel(status: ImportBookingResult['status']): string {
  return ISSUE_STATUS_LABELS[status] ?? status;
}

function parseAmount(raw: string | undefined): number {
  const trimmed = (raw ?? '').trim();
  if (BLANK_AMOUNT_VALUES.has(trimmed.toLowerCase())) return 0;
  return Number(trimmed);
}

function buildRows(headers: string[], rawRows: string[][], mapping: ColumnMapping): ImportBookingRow[] {
  return rawRows.map((raw) => {
    const get = (key: string): string | undefined => {
      const header = mapping[key];
      if (!header) return undefined;
      const colIndex = headers.indexOf(header);
      return colIndex >= 0 ? raw[colIndex] : undefined;
    };

    const invoiceCell = (get('invoiceNumber') ?? '').trim().toUpperCase();
    let bookingType: 'New' | 'Reissue' | 'Refund' = 'New';
    let invoiceNumber: string | undefined = get('invoiceNumber');
    if (invoiceCell === 'REISSUE') {
      bookingType = 'Reissue';
      invoiceNumber = undefined;
    } else if (invoiceCell === 'REFUND') {
      bookingType = 'Refund';
      invoiceNumber = undefined;
    }

    const voidedRaw = get('voided');

    return {
      bookingType,
      bookingDate: get('bookingDate') ?? '',
      invoiceNumber,
      passengerName: get('passengerName') ?? '',
      amount: parseAmount(get('amount')),
      voided: voidedRaw ? TRUTHY_VOIDED_VALUES.has(voidedRaw.trim().toLowerCase()) : undefined,
      pnr: get('pnr'),
      airlineCode: get('airlineCode'),
      depCity: get('depCity'),
      arrCity: get('arrCity'),
      depDate: get('depDate'),
      arrDate: get('arrDate'),
      remark: get('remark'),
      pendingAmount: parseAmount(get('pendingAmount')),
      // Raw per-row status/type text; the backend parses tolerantly and falls back to the batch
      // payment default when blank/unmapped/unrecognized.
      paymentStatus: get('paymentStatus'),
      paymentType: get('paymentType'),
    };
  });
}

export default function BookingImportWizard() {
  const queryClient = useQueryClient();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [paymentDefault, setPaymentDefault] = useState<PaymentDefault>({ status: 'paid', type: 'card' });
  const [report, setReport] = useState<ImportBookingResult[]>([]);
  const [committed, setCommitted] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const parsed = await parseXlsxFile(file);
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
    } catch {
      setError('Could not read that file — make sure it is a valid .xlsx.');
    }
  }

  async function handlePreview() {
    setError(null);
    setBusy(true);
    try {
      const rows = buildRows(headers, rawRows, mapping);
      const results = await importBookings(rows, paymentDefault, true);
      setReport(results);
      setCommitted(false);
    } catch {
      setError('Import request failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setError(null);
    setBusy(true);
    try {
      const rows = buildRows(headers, rawRows, mapping);
      const results = await importBookings(rows, paymentDefault, false);
      setReport(results);
      setCommitted(true);
      // The Bookings/Sales tables cache their list queries under these prefixes; without this the
      // freshly-imported rows don't appear until a manual page refresh.
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    } catch {
      setError('Import request failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  // flagged_duplicate belongs with the issues: the row was NOT imported (the passenger is already
  // on that invoice), and a user re-running a spreadsheet must be able to see that is why nothing
  // landed — a report that showed neither an import nor a problem would be a lie.
  const issueRows = report.filter(
    (r) => r.status === 'needs_manual_linking' || r.status === 'failed' || r.status === 'flagged_duplicate'
  );
  const okRows = report.filter((r) => r.status === 'imported' || r.status === 'would_import');

  return (
    <div className="space-y-4">
      <Input aria-label="Booking import file" type="file" accept=".xlsx" onChange={handleFileChange} />

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Label>Payment status</Label>
          <Select
            value={paymentDefault.status}
            onValueChange={(v) => setPaymentDefault({ ...paymentDefault, status: v as 'paid' | 'pending' })}
          >
            <SelectTrigger aria-label="Import payment status" className="w-32">
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
            value={paymentDefault.type}
            onValueChange={(v) => setPaymentDefault({ ...paymentDefault, type: v as 'card' | 'check' | 'cash' })}
          >
            <SelectTrigger aria-label="Import payment type" className="w-32">
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

      {headers.length > 0 && (
        <>
          <ColumnMapper sourceHeaders={headers} targetFields={TARGET_FIELDS} mapping={mapping} onChange={setMapping} />
          <Button type="button" onClick={handlePreview} disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Working…' : 'Preview'}
          </Button>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {report.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {okRows.length} of {report.length} row(s) {committed ? 'imported' : 'ready to import'}.
          {issueRows.length > 0 && ` ${issueRows.length} need attention below.`}
        </p>
      )}

      {issueRows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issueRows.map((r) => (
              <TableRow key={r.index}>
                <TableCell>{r.index + 1}</TableCell>
                <TableCell>{issueStatusLabel(r.status)}</TableCell>
                <TableCell>{r.reason ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {report.length > 0 && !committed && (
        <Button type="button" onClick={handleCommit} disabled={busy}>
          {busy && <Spinner />}
          {busy ? 'Working…' : 'Commit Import'}
        </Button>
      )}
    </div>
  );
}
