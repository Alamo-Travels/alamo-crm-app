import { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, IdCard, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CustomerListItem } from '@/api/customers.api';
import { CopyableText } from '@/components/data-table/copyable-text';
import { dobToDigits, dobToIso, formatDisplayDate } from '@/utils/dateFormat';
import { formatPhone, phoneCopyValue } from '@/utils/phoneFormat';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { CustomerRowActions } from './customer-row-actions';

interface BuildCustomerColumnsArgs {
  onEdit: (customer: CustomerListItem) => void;
  onDelete: (customer: CustomerListItem) => void;
  onViewPassport: (customer: CustomerListItem) => void;
  onToggleVerified: (customer: CustomerListItem) => void;
  canToggleVerified: boolean;
}

export function buildCustomerColumns({
  onEdit,
  onDelete,
  onViewPassport,
  onToggleVerified,
  canToggleVerified,
}: BuildCustomerColumnsArgs): ColumnDef<CustomerListItem>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={`Select ${row.original.firstName} ${row.original.lastName}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: 'ticketingName',
      accessorFn: (c) => `${c.lastName}/${c.firstName}${c.middleName ? ` ${c.middleName}` : ''}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Ticketing Name" />,
      meta: { label: 'Ticketing Name' },
      cell: ({ getValue }) => <CopyableText value={getValue<string>()} maxChars={25} />,
    },
    {
      id: 'givenName',
      accessorFn: (c) => c.givenName ?? c.firstName,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Given Name" />,
      meta: { label: 'Given Name' },
    },
    {
      id: 'lastName',
      accessorKey: 'lastName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Last Name" />,
      meta: { label: 'Last Name' },
    },
    {
      id: 'dob',
      accessorKey: 'dob',
      header: () => <span>Date of Birth</span>,
      meta: { label: 'Date of Birth' },
      enableSorting: false,
      cell: ({ getValue }) => {
        const dob = getValue<string>();
        return <CopyableText value={formatDisplayDate(dobToIso(dob))} copyValue={dobToDigits(dob)} />;
      },
    },
    {
      id: 'paxType',
      accessorKey: 'paxType',
      header: () => <div className="text-center">PAX Type</div>,
      meta: { label: 'PAX Type' },
      enableSorting: false,
      cell: ({ getValue }) => <div className="text-center">{getValue<string>()}</div>,
    },
    {
      id: 'gender',
      accessorKey: 'gender',
      header: () => <div className="text-center">Gender</div>,
      meta: { label: 'Gender' },
      enableSorting: false,
      cell: ({ row }) => {
        const gender = row.original.gender;
        if (gender === 'M') {
          return (
            <div className="flex justify-center">
              <Badge className="border-blue-200 bg-blue-100 text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                Male
              </Badge>
            </div>
          );
        }
        if (gender === 'F') {
          return (
            <div className="flex justify-center">
              <Badge className="border-pink-200 bg-pink-100 text-pink-800 hover:bg-pink-100 dark:border-pink-800 dark:bg-pink-950 dark:text-pink-300">
                Female
              </Badge>
            </div>
          );
        }
        return (
          <div className="flex justify-center">
            <Badge variant="secondary">Other</Badge>
          </div>
        );
      },
    },
    {
      id: 'email',
      accessorFn: (c) => c.email ?? '',
      header: () => <span>Email</span>,
      meta: { label: 'Email' },
      enableSorting: false,
      cell: ({ getValue }) => <CopyableText value={getValue<string>()} maxChars={30} />,
    },
    {
      id: 'phone',
      accessorKey: 'phone',
      header: () => <span>Phone</span>,
      meta: { label: 'Phone' },
      enableSorting: false,
      cell: ({ getValue }) => {
        const phone = getValue<string>();
        return <CopyableText value={formatPhone(phone)} copyValue={phoneCopyValue(phone)} />;
      },
    },
    {
      id: 'status',
      accessorFn: (c) => (c.verified ? 'verified' : 'unverified'),
      header: () => <div className="text-center">Verified</div>,
      meta: { label: 'Verified' },
      enableSorting: false,
      cell: ({ row }) => {
        const { verified, firstName, lastName } = row.original;
        const icon = verified ? (
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" aria-label="Verified" />
        ) : (
          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" aria-label="Not verified" />
        );
        return (
          <div className="flex justify-center">
            {canToggleVerified ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label={`Toggle verified status for ${firstName} ${lastName}`}
                onClick={() => onToggleVerified(row.original)}
              >
                {icon}
              </Button>
            ) : (
              icon
            )}
          </div>
        );
      },
    },
    {
      id: 'passport',
      header: () => <div className="text-center">Passport</div>,
      meta: { label: 'Passport' },
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={!row.original.passport}
            aria-label={`View passport for ${row.original.firstName} ${row.original.lastName}`}
            onClick={() => onViewPassport(row.original)}
          >
            <IdCard className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => <CustomerRowActions customer={row.original} onEdit={onEdit} onDelete={onDelete} />,
    },
  ];
}
