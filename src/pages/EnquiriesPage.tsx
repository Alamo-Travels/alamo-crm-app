import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/search-input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ENQUIRY_PAGE_SIZES, ENQUIRY_STATUSES, EnquiryStatus, listEnquiries } from '@/api/enquiries.api';
import { EnquiryDialog } from '@/components/enquiries/enquiry-dialog';
import { EnquiryStatusBadge } from '@/components/enquiries/enquiry-status-badge';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { DataTableFacetedFilter } from '@/components/data-table/data-table-faceted-filter';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { COMPACT_CELL_CLASS, COMPACT_HEAD_CLASS } from '@/components/data-table/table-density';
import { formatDisplayDate } from '@/utils/dateFormat';
import { formatPhone } from '@/utils/phoneFormat';
import { formatItinerary, formatPax, formatSegmentDates } from '@/utils/tripFormat';

const STATUS_OPTIONS = ENQUIRY_STATUSES.map((s) => ({ label: s, value: s }));

const HEADERS = ['Date received', 'Enquirer', 'Phone', 'Route', 'Travel dates', 'Pax', 'Status', 'Quote sent'];

export default function EnquiriesPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusValues, setStatusValues] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const status = statusValues.size === 1 ? (Array.from(statusValues)[0] as EnquiryStatus) : undefined;

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, status, pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: ['enquiries', 'list', { page, pageSize, q: debouncedQuery, status }],
    queryFn: () => listEnquiries({ page, pageSize, q: debouncedQuery || undefined, status }),
    placeholderData: keepPreviousData,
  });

  const enquiries = data?.enquiries ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="mx-auto max-w-[1800px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Enquiries</h2>
        <Button type="button" size="sm" onClick={() => setShowCreate(true)}>
          New Enquiry
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          aria-label="Search enquiries"
          placeholder="Search by name, phone, email, or route…"
          value={searchInput}
          onChange={setSearchInput}
          className="w-[220px] lg:w-[300px]"
        />
        <DataTableFacetedFilter title="Status" options={STATUS_OPTIONS} selectedValues={statusValues} onChange={setStatusValues} />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {HEADERS.map((h) => (
                <TableHead key={h} className={cn('whitespace-nowrap', COMPACT_HEAD_CLASS)}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton columns={HEADERS.length} rows={pageSize} cellClassName={COMPACT_CELL_CLASS} />
            ) : enquiries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={HEADERS.length} className="h-24 text-center text-muted-foreground">
                  No enquiries found.
                </TableCell>
              </TableRow>
            ) : (
              enquiries.map((enquiry, index) => (
                <TableRow
                  key={enquiry.id}
                  className={cn('cursor-pointer', index % 2 === 1 && 'bg-muted/60')}
                  onClick={() => navigate({ to: '/enquiries/$enquiryId', params: { enquiryId: enquiry.id } })}
                >
                  <TableCell className={cn('whitespace-nowrap', COMPACT_CELL_CLASS)}>
                    {formatDisplayDate(enquiry.createdAt)}
                  </TableCell>
                  <TableCell className={cn('whitespace-nowrap font-medium', COMPACT_CELL_CLASS)}>
                    {enquiry.enquirer.name}
                  </TableCell>
                  <TableCell className={cn('whitespace-nowrap', COMPACT_CELL_CLASS)}>
                    {formatPhone(enquiry.enquirer.phone)}
                  </TableCell>
                  <TableCell className={cn('whitespace-nowrap', COMPACT_CELL_CLASS)}>
                    {formatItinerary(enquiry.trip.segments)}
                  </TableCell>
                  <TableCell className={cn('whitespace-nowrap', COMPACT_CELL_CLASS)}>
                    {formatSegmentDates(enquiry.trip.segments)}
                    {enquiry.trip.dateFlexibility && (
                      <span className="ml-1 text-xs text-muted-foreground">({enquiry.trip.dateFlexibility})</span>
                    )}
                  </TableCell>
                  <TableCell className={cn('whitespace-nowrap text-center', COMPACT_CELL_CLASS)}>
                    {formatPax(enquiry.trip.pax)}
                  </TableCell>
                  <TableCell className={cn('whitespace-nowrap', COMPACT_CELL_CLASS)}>
                    <EnquiryStatusBadge status={enquiry.status} />
                  </TableCell>
                  <TableCell className={cn('whitespace-nowrap', COMPACT_CELL_CLASS)}>
                    {enquiry.quoteSentAt ? formatDisplayDate(enquiry.quoteSentAt) : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        page={page}
        pageSize={pageSize}
        pageSizes={ENQUIRY_PAGE_SIZES}
        total={total}
        selectedCount={0}
        currentPageRowCount={enquiries.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <EnquiryDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
