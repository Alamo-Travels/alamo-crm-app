import { ChangeEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parseXlsxFile } from '../utils/xlsxParse';
import ColumnMapper, { ColumnMapping, TargetField } from './ColumnMapper';
import { importCustomers, ImportCustomerRow, ImportRowResult } from '../api/customers.api';

const TRUTHY_VERIFIED_VALUES = new Set(['true', 'yes', 'y', '1', 't']);

const TARGET_FIELDS: TargetField[] = [
  { key: 'givenName', label: 'Given Name', required: true },
  { key: 'lastName', label: 'Last Name', required: true },
  { key: 'dob', label: 'DOB', required: true },
  { key: 'gender', label: 'Gender' },
  { key: 'phone', label: 'Phone', required: true },
  { key: 'email', label: 'Email' },
  { key: 'verified', label: 'Verified' },
];

function splitGivenName(value: string | undefined): { firstName: string; middleName?: string } {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return { firstName: '' };
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) return { firstName: trimmed };
  return { firstName: trimmed.slice(0, spaceIndex), middleName: trimmed.slice(spaceIndex + 1).trim() || undefined };
}

function buildRows(headers: string[], rawRows: string[][], mapping: ColumnMapping): ImportCustomerRow[] {
  return rawRows.map((raw) => {
    const get = (key: string): string | undefined => {
      const header = mapping[key];
      if (!header) return undefined;
      const colIndex = headers.indexOf(header);
      return colIndex >= 0 ? raw[colIndex] : undefined;
    };
    const verifiedRaw = get('verified');
    const { firstName, middleName } = splitGivenName(get('givenName'));
    return {
      firstName,
      middleName,
      lastName: get('lastName') ?? '',
      dob: get('dob') ?? '',
      gender: get('gender'),
      phone: get('phone') ?? '',
      email: get('email'),
      verified: verifiedRaw ? TRUTHY_VERIFIED_VALUES.has(verifiedRaw.trim().toLowerCase()) : undefined,
    };
  });
}

export default function CustomerImportWizard() {
  const queryClient = useQueryClient();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [report, setReport] = useState<ImportRowResult[]>([]);
  const [forceImportIndices, setForceImportIndices] = useState<Set<number>>(new Set());
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
      const results = await importCustomers(rows, true);
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
      const rows = buildRows(headers, rawRows, mapping).map((row, index) => ({
        ...row,
        forceImport: forceImportIndices.has(index) ? true : undefined,
      }));
      const results = await importCustomers(rows, false);
      setReport(results);
      setCommitted(true);
      // Refresh the Customers list so imported rows appear without a manual page reload.
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch {
      setError('Import request failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function toggleForceImport(index: number) {
    setForceImportIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const issueRows = report.filter((r) => r.status === 'flagged_duplicate' || r.status === 'failed');
  const okRows = report.filter((r) => r.status === 'imported' || r.status === 'would_import');

  return (
    <div className="space-y-4">
      <Input aria-label="Customer import file" type="file" accept=".xlsx" onChange={handleFileChange} />

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
              <TableHead>Import anyway</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issueRows.map((r) => (
              <TableRow key={r.index}>
                <TableCell>{r.index + 1}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{r.reason ?? ''}</TableCell>
                <TableCell>
                  {r.status === 'flagged_duplicate' && !committed && (
                    <Checkbox
                      aria-label={`Import row ${r.index + 1} anyway`}
                      checked={forceImportIndices.has(r.index)}
                      onCheckedChange={() => toggleForceImport(r.index)}
                    />
                  )}
                </TableCell>
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
