import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BookingsTable } from '@/components/bookings/bookings-table';
import { CreateBookingDialog } from '@/components/bookings/create-booking-dialog';
import { ImportBookingsDialog } from '@/components/bookings/import-bookings-dialog';
import { ExportBookingsDialog } from '@/components/bookings/export-bookings-dialog';
import { VoidedInvoicesDialog } from '@/components/bookings/voided-invoices-dialog';
import { SendInvoiceDialog } from '@/components/bookings/send-invoice-dialog';
import { useAuthStore } from '@/stores/authStore';
import { canCreateAdjustments, canCreateBookings, canImportExport, canSendInvoices } from '@/utils/permissions';

export default function BookingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canExport = canImportExport(user, 'bookings', 'export');
  const canImport = canImportExport(user, 'bookings', 'import');
  const canSendInvoice = canSendInvoices(user);
  // The Create Booking dialog serves BOTH new bookings AND Reissue/Refund adjustments — two
  // different permissions. Show the entry point if the user has either one; hiding it when they
  // have only createAdjustment would remove their only route to recording a reissue.
  const canCreate = canCreateBookings(user) || canCreateAdjustments(user);
  // Scan Invoices is gated on canCreateBookings specifically (not the broader canCreate above) —
  // saving a scanned invoice goes through POST /api/bookings (bookings.create), matching the
  // /bookings/scan route's own beforeLoad gate exactly.
  const canScan = canCreateBookings(user);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showVoided, setShowVoided] = useState(false);
  const [showSendInvoice, setShowSendInvoice] = useState(false);

  return (
    <div className="mx-auto max-w-[1800px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Bookings</h2>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setShowVoided(true)}>
            Voided Invoices
          </Button>
          {canScan && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate({ to: '/bookings/scan' })}
            >
              <ScanLine />
              Scan Invoices
            </Button>
          )}
          {canSendInvoice && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowSendInvoice(true)}>
              Send Invoice
            </Button>
          )}
          {canExport && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowExport(true)}>
              Export
            </Button>
          )}
          {canImport && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowImport(true)}>
              Import Bookings
            </Button>
          )}
          {canCreate && (
            <Button type="button" size="sm" onClick={() => setShowCreate(true)}>
              Create booking
            </Button>
          )}
        </div>
      </div>

      <BookingsTable queryKeyPrefix="bookings" defaultPageSize={25} />

      {canCreate && <CreateBookingDialog open={showCreate} onOpenChange={setShowCreate} />}
      {canImport && <ImportBookingsDialog open={showImport} onOpenChange={setShowImport} />}
      {canExport && <ExportBookingsDialog open={showExport} onOpenChange={setShowExport} />}
      <VoidedInvoicesDialog open={showVoided} onOpenChange={setShowVoided} />
      {canSendInvoice && <SendInvoiceDialog open={showSendInvoice} onOpenChange={setShowSendInvoice} />}
    </div>
  );
}
