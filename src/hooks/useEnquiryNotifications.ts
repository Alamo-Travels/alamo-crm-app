import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { connectRealtime, getSocket } from '../api/realtime';
import { KIND_LABELS, EnquiryKind } from '../api/enquiries.api';

/** Must match ENQUIRY_CREATED in alamo-crm-api/src/realtime/enquiryBridge.ts — hand-synced. */
const ENQUIRY_CREATED = 'enquiry:created';

interface EnquiryCreatedEvent {
  id: string;
  enquirerName: string;
  kind: EnquiryKind;
  createdAt: string;
}

/**
 * Toasts newly-arrived website enquiries and refreshes the sidebar count.
 *
 * Mounted in AppShell, which means it never runs on /login — that route sits outside the shell.
 *
 * Note there is no "catch up on what I missed" logic and none is wanted: you only receive events
 * that occur while you are connected, so six enquiries overnight produce a badge reading 6 and no
 * toast at all. That is the required behaviour (spec §2.2), and the transport gives it for free.
 */
export function useEnquiryNotifications(): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    connectRealtime();
    const socket = getSocket();

    const onCreated = (event: EnquiryCreatedEvent): void => {
      toast.info(`New website enquiry — ${event.enquirerName} (${KIND_LABELS[event.kind]})`, {
        action: {
          label: 'View',
          onClick: () => {
            void navigate({ to: '/enquiries/$enquiryId', params: { enquiryId: event.id } });
          },
        },
      });
      // ONE invalidate. TanStack Query matches by key PREFIX, so this covers both the badge count
      // (['enquiries','unread-count']) and any open list page (['enquiries','list',…]). Invalidating
      // the two separately would be redundant, not safer.
      void queryClient.invalidateQueries({ queryKey: ['enquiries'] });
    };

    socket.on(ENQUIRY_CREATED, onCreated);
    return () => {
      socket.off(ENQUIRY_CREATED, onCreated);
    };
  }, [queryClient, navigate]);
}
