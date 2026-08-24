import { useState } from 'react';
import { OnChangeFn, RowSelectionState, SortingState, Updater, VisibilityState } from '@tanstack/react-table';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { GroupResultsTable } from './group-results-table';
import { DEFAULT_GROUP_PAGE_SIZE, getGroupResults, GroupSortBy, GroupView, updateGroupExclusions } from '@/api/groups.api';

interface ExcludedRowsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  /** The group's saved view, so this list opens with the SAME columns the user has configured on
   * the group's own results table. Absent means "the table's built-in defaults", same as a group
   * that has never had a view saved. */
  view?: GroupView;
}

/**
 * Lists the rows checked off this group and lets them be restored.
 *
 * Backed by an endpoint that deliberately IGNORES the group's conditions: a row that was excluded
 * and has since stopped matching must still appear, or it could never be restored, and this is the
 * only surface that can restore one.
 *
 * Restore is bulk-only via the selection column; selecting a single row covers the one-row case.
 *
 * The stateful body lives in ExcludedRowsDialogBody INSIDE DialogContent. The caller mounts this
 * gated on `group`, not on `open`, so the outer component never unmounts — but Radix does unmount
 * DialogContent, so keeping the state there gives every reopen a fresh mount. Otherwise a
 * selection made and abandoned in one cycle would survive into the next and let "Restore selected"
 * restore rows the user never re-confirmed.
 */
export function ExcludedRowsDialog({ open, onOpenChange, groupId, view }: ExcludedRowsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1400px]">
        <DialogHeader>
          <DialogTitle>Excluded rows</DialogTitle>
          <DialogDescription>
            Rows you have checked off. They are hidden from this group&apos;s results. Select any and
            restore them to bring them back.
          </DialogDescription>
        </DialogHeader>

        <ExcludedRowsDialogBody groupId={groupId} view={view} />
      </DialogContent>
    </Dialog>
  );
}

interface ExcludedRowsDialogBodyProps {
  groupId: string;
  view?: GroupView;
}

function ExcludedRowsDialogBody({ groupId, view }: ExcludedRowsDialogBodyProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_GROUP_PAGE_SIZE);
  const [sorting, setSorting] = useState<SortingState>([]);
  // Seeded ONCE from the group's saved view (lazy initializer), mirroring GroupResultsSection in
  // GroupResultsPage.tsx so this list opens with the same columns as the group's own table. The
  // body remounts on every dialog open, so each open re-seeds from the current saved view.
  //
  // Column changes made HERE are deliberately session-only and are NOT persisted back: this dialog
  // has no useGroupView, because writing from here would let the excluded-rows list silently
  // overwrite the saved view of the group's main results table.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries((view?.hiddenColumns ?? []).map((id) => [id, false]))
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const queryClient = useQueryClient();

  const selectedIds = Object.keys(rowSelection);

  const sortBy = sorting[0]?.id as GroupSortBy | undefined;
  const sortDir = sorting[0] ? (sorting[0].desc ? 'desc' : 'asc') : undefined;

  // Page and sort/size must change together in the SAME state update, or `useQuery` fires once
  // with the OLD page and the NEW sort/size (a wasted round trip) before a separate effect catches
  // up and resets the page. Mirrors GroupResultsSection's handleSortingChange/onPageSizeChange.
  const handleSortingChange: OnChangeFn<SortingState> = (updater: Updater<SortingState>) => {
    setSorting(updater);
    setPage(1);
  };

  const { data: result, isFetching } = useQuery({
    queryKey: ['groups', groupId, 'results', 'excluded', { page, pageSize, sortBy, sortDir }],
    queryFn: () => getGroupResults(groupId, { page, pageSize, sortBy, sortDir, excluded: true }),
    placeholderData: keepPreviousData,
  });

  // The mutation carries its ids as VARIABLES (never closes over `selectedIds`) because
  // MutationObserver.setOptions() re-runs on every render and swaps an in-flight mutation's
  // callbacks for the latest render's closure — if onSuccess read `selectedIds` directly, selecting
  // more rows while the first request is still pending would make the eventual toast/deselect use
  // the WRONG (later) count. TanStack's second onSuccess argument is the variables that were
  // actually submitted, so it always reflects what this particular request sent, regardless of how
  // many times the component has re-rendered since. Mirrors GroupResultsPage.tsx's excludeMutation.
  const restoreMutation = useMutation({
    mutationFn: (ids: string[]) => updateGroupExclusions(groupId, { remove: ids }),
    onSuccess: (_data, submittedIds) => {
      // Deselect only the ids that were actually submitted — not the whole selection — so a
      // selection made while the request was in flight survives. Functional update so this reads
      // the CURRENT state, not a stale closure.
      setRowSelection((prev) => {
        const next = { ...prev };
        for (const id of submittedIds) delete next[id];
        return next;
      });
      // Restoring can drop the last row(s) off the current page (e.g. restoring all 3 rows on page
      // 4 of 4 leaves the user stranded on an empty page). Reset to page 1 rather than computing the
      // new page count.
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ['groups', groupId] });
      toast.success(submittedIds.length === 1 ? 'Row restored' : `${submittedIds.length} rows restored`);
    },
    onError: () => {
      toast.error('Could not restore those rows. Please try again.');
    },
  });

  return (
    <GroupResultsTable
      result={result ?? null}
      busy={isFetching}
      page={page}
      pageSize={pageSize}
      sorting={sorting}
      columnVisibility={columnVisibility}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      toolbarActions={
        selectedIds.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={restoreMutation.isPending}
            onClick={() => restoreMutation.mutate(selectedIds)}
          >
            {restoreMutation.isPending && <Spinner className="mr-2" />}
            Restore selected ({selectedIds.length})
          </Button>
        ) : null
      }
      onPageChange={setPage}
      onPageSizeChange={(next) => {
        setPageSize(next);
        setPage(1);
      }}
      onSortingChange={handleSortingChange}
      onColumnVisibilityChange={setColumnVisibility}
    />
  );
}
