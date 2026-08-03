import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatDisplayDate } from '@/utils/dateFormat';
import { ReviewInvoice, ReviewStatus } from './reviewInvoice';

const STATUS_LABELS: Record<ReviewStatus, string> = {
  ready: 'Ready',
  attention: 'Needs attention',
  duplicate: 'Needs decision',
  saved: 'Saved',
  failed: 'Failed',
};

const STATUS_VARIANTS: Record<ReviewStatus, string> = {
  ready: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  attention: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  // Deliberately a DIFFERENT hue from `attention` (amber) — a duplicate hit during a batch save
  // must read as visually distinct from "still needs review", not just textually distinct, so a
  // quick scan of the list can't mistake one for the other.
  duplicate: 'bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100',
  saved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
};

interface ScanInvoiceListProps {
  invoices: ReviewInvoice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function ScanInvoiceList({ invoices, selectedId, onSelect }: ScanInvoiceListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="whitespace-nowrap">Pages</TableHead>
          <TableHead className="whitespace-nowrap">Invoice #</TableHead>
          <TableHead className="whitespace-nowrap">Date</TableHead>
          <TableHead className="whitespace-nowrap">PAX</TableHead>
          <TableHead className="whitespace-nowrap">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow
            key={invoice.id}
            onClick={() => onSelect(invoice.id)}
            className={cn('cursor-pointer', selectedId === invoice.id && 'bg-muted')}
          >
            <TableCell className="whitespace-nowrap">
              {invoice.pageStart === invoice.pageEnd
                ? invoice.pageStart
                : `${invoice.pageStart}–${invoice.pageEnd}`}
            </TableCell>
            <TableCell className="whitespace-nowrap">{invoice.invoiceNumber ?? invoice.type}</TableCell>
            <TableCell className="whitespace-nowrap">
              {invoice.bookingDate ? formatDisplayDate(invoice.bookingDate) : '—'}
            </TableCell>
            <TableCell className="whitespace-nowrap">{invoice.passengers.length}</TableCell>
            <TableCell className="whitespace-nowrap">
              <Badge className={STATUS_VARIANTS[invoice.status]}>{STATUS_LABELS[invoice.status]}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
