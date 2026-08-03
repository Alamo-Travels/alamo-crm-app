import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { formatDisplayDate } from '@/utils/dateFormat';
import { BOOKING_PAGE_SIZES, listBookings } from '@/api/bookings.api';

interface VoidedInvoicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The dialog body, and the sole owner of page/pageSize. Radix unmounts DialogContent on close, so
 * this remounts on every open and the paging state re-seeds to page 1 with no reset effect — the
 * key-based-remount pattern this codebase prefers over watching `open` in an effect. */
function VoidedInvoicesTable() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const { data, isLoading } = useQuery({
    queryKey: ['bookings', 'voided', page, pageSize],
    // Newest voided invoice first. 'date' is the backend's sort key for bookingDate (a Reissue or
    // Refund carries its own, falling back to the parent booking's), and desc is already its
    // default — sent explicitly so the order can't drift if that default ever changes.
    queryFn: () => listBookings({ voided: true, page, pageSize, sortBy: 'date', sortDir: 'desc' }),
    // Keeps the previous page's rows on screen while the next one loads, so the dialog doesn't
    // collapse to a "Loading…" row and jump in height on every page click.
    placeholderData: keepPreviousData,
  });

  const rows = data?.bookings ?? [];

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Booking Date</TableHead>
            <TableHead>Invoice#</TableHead>
            <TableHead>Remark</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                No voided invoices.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">{formatDisplayDate(row.bookingDate)}</TableCell>
                <TableCell className="font-medium">{row.invoiceNumber}</TableCell>
                <TableCell className="text-muted-foreground">{row.remark ?? ''}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <DataTablePagination
        page={page}
        pageSize={pageSize}
        pageSizes={BOOKING_PAGE_SIZES}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          // Page 4 of a 10-row paging can not exist once the page size is 100.
          setPage(1);
        }}
      />
    </>
  );
}

export function VoidedInvoicesDialog({ open, onOpenChange }: VoidedInvoicesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panel dismissible={false} className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Voided invoices</DialogTitle>
        </DialogHeader>
        <VoidedInvoicesTable />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
