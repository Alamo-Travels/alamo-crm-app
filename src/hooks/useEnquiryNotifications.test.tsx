import { EventEmitter } from 'events';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitter = new EventEmitter();
const fakeSocket = {
  on: (event: string, handler: (...args: unknown[]) => void) => emitter.on(event, handler),
  off: (event: string, handler: (...args: unknown[]) => void) => emitter.off(event, handler),
  connected: false,
};

vi.mock('../api/realtime', () => ({
  getSocket: () => fakeSocket,
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

import { useEnquiryNotifications } from './useEnquiryNotifications';
import { connectRealtime } from '../api/realtime';

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useEnquiryNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitter.removeAllListeners();
  });

  it('connects on mount', () => {
    const client = new QueryClient();
    renderHook(() => useEnquiryNotifications(), { wrapper: wrapper(client) });
    expect(connectRealtime).toHaveBeenCalled();
  });

  it('toasts the enquirer name and kind when an enquiry arrives', async () => {
    const spy = vi.spyOn(toast, 'info');
    const client = new QueryClient();
    renderHook(() => useEnquiryNotifications(), { wrapper: wrapper(client) });

    emitter.emit('enquiry:created', {
      id: 'e1', enquirerName: 'Priya Nair', kind: 'cruise', createdAt: '2026-08-12T10:00:00.000Z',
    });

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('New website enquiry — Priya Nair (Cruise)', expect.anything())
    );
  });

  it('invalidates the enquiries key ONCE — prefix matching covers both the count and any list', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderHook(() => useEnquiryNotifications(), { wrapper: wrapper(client) });

    emitter.emit('enquiry:created', {
      id: 'e1', enquirerName: 'Priya Nair', kind: 'flight', createdAt: '2026-08-12T10:00:00.000Z',
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['enquiries'] });
  });

  it('removes its listener on unmount so a remount does not double-toast', () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => useEnquiryNotifications(), { wrapper: wrapper(client) });
    expect(emitter.listenerCount('enquiry:created')).toBe(1);
    unmount();
    expect(emitter.listenerCount('enquiry:created')).toBe(0);
  });
});
