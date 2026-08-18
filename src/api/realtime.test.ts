import { describe, expect, it, vi, beforeEach } from 'vitest';
import { socketOrigin } from './realtime';

describe('socketOrigin', () => {
  // socket.io mounts at /socket.io on the API ORIGIN, not under /api.
  it('strips the /api suffix VITE_API_URL is required to carry', () => {
    expect(socketOrigin('http://localhost:4000/api')).toBe('http://localhost:4000');
    expect(socketOrigin('https://api.alamotravels.com/api')).toBe('https://api.alamotravels.com');
  });

  it('tolerates a trailing slash', () => {
    expect(socketOrigin('http://localhost:4000/api/')).toBe('http://localhost:4000');
  });

  it('leaves a URL with no /api suffix alone', () => {
    expect(socketOrigin('http://localhost:4000')).toBe('http://localhost:4000');
  });

  // Guards the obvious over-eager regex: only a TRAILING /api may be removed.
  it('does not strip /api from the middle of a host or path', () => {
    expect(socketOrigin('https://api.example.com/apiv2')).toBe('https://api.example.com/apiv2');
  });
});

/**
 * The `auth` option's CALLBACK form is the single highest-risk line in the feature (see
 * realtime.ts's doc comment): socket.io re-invokes it on every reconnect, so it must re-read the
 * CURRENT access token from the store rather than a token captured once at construction. jsdom has
 * no WebSocket, so the live connection can't be exercised here — but the SHAPE of the `auth` option
 * needs no WebSocket at all, and is exactly the thing a future "simplification" to a static
 * `auth: { token }` object would silently break: it would still compile, still pass lint, and the
 * socket would just die ~15 minutes after every sign-in.
 *
 * `socket.io-client` is mocked so we can capture what `io()` was actually called with, and
 * `vi.resetModules()` + a fresh dynamic import is used each test because `getSocket()` caches its
 * singleton at module scope — a second `getSocket()` call in the same module instance wouldn't
 * call `io()` again.
 */
describe('getSocket — the auth option', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  interface CapturedIoOptions {
    auth?: (cb: (data: { token: string }) => void) => void;
  }

  function stubSocket(): {
    connected: boolean;
    active: boolean;
    connect: () => void;
    disconnect: () => void;
    on: (event: string, handler: (arg?: unknown) => void) => void;
  } {
    return {
      connected: false,
      active: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
    };
  }

  type IoCall = (url: string, opts: CapturedIoOptions) => ReturnType<typeof stubSocket>;

  async function captureAuthOption(): Promise<CapturedIoOptions['auth']> {
    const ioMock = vi.fn<IoCall>(() => stubSocket());
    vi.doMock('socket.io-client', () => ({ io: ioMock }));

    const { getSocket } = await import('./realtime');
    getSocket();

    const [, options] = ioMock.mock.calls[0] ?? [];
    return options?.auth;
  }

  it('passes auth as a function, not a static object', async () => {
    const authFn = await captureAuthOption();
    expect(typeof authFn).toBe('function');
  });

  it('auth re-reads the current token from the store on every invocation, not once at construction', async () => {
    const { useAuthStore } = await import('../stores/authStore');
    useAuthStore.getState().setAccessToken('token-a');

    const authFn = await captureAuthOption();
    if (!authFn) throw new Error('auth option was not a function');

    const first = vi.fn();
    authFn(first);
    expect(first).toHaveBeenCalledWith({ token: 'token-a' });

    // Mutate the store AFTER the socket/options were constructed, then invoke the SAME captured
    // function again. A callback that snapshotted the token at construction would still yield
    // 'token-a' here — this is the assertion that actually distinguishes the callback form from
    // the static-object regression.
    useAuthStore.getState().setAccessToken('token-b');

    const second = vi.fn();
    authFn(second);
    expect(second).toHaveBeenCalledWith({ token: 'token-b' });
  });
});

/**
 * The revival handler, which is the ONLY thing keeping realtime alive past the first ~15 minutes.
 *
 * The API hangs each socket up at its access token's expiry via `socket.disconnect(true)`, i.e. a
 * namespace DISCONNECT packet, i.e. reason 'io server disconnect'. socket.io-client does NOT
 * auto-reconnect from that (it sets skipReconnect internally; `socket.active` goes false and no
 * reconnect_attempt ever fires — measured against the installed 4.8.3 over a 25s window). So the
 * client has to reconnect itself, AND refresh the token first, since the token is what expired.
 *
 * jsdom has no WebSocket, so a real reconnect cannot be exercised here and no test below pretends
 * to. What IS testable — and is exactly where the bug lived — is the WIRING: which disconnect
 * reasons trigger a revival, that a refresh precedes the reconnect, and that the loop is bounded.
 */
describe('getSocket — revival after a server-initiated hangup', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /** Lets every pending microtask (revive's awaited refresh, then its connect()) settle. */
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  interface Harness {
    handlers: Record<string, (arg?: unknown) => void>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    ensureFreshAccessToken: ReturnType<typeof vi.fn>;
    setActive: (value: boolean) => void;
    useAuthStore: typeof import('../stores/authStore').useAuthStore;
  }

  async function setup(options: { refreshFails?: boolean } = {}): Promise<Harness> {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const connect = vi.fn();
    const disconnect = vi.fn();
    const socketStub = {
      connected: false,
      active: false,
      connect,
      disconnect,
      on: (event: string, handler: (arg?: unknown) => void) => {
        handlers[event] = handler;
      },
    };
    vi.doMock('socket.io-client', () => ({ io: vi.fn(() => socketStub) }));

    const ensureFreshAccessToken = vi.fn(async (): Promise<void> => {
      if (options.refreshFails) throw new Error('refresh failed');
    });
    vi.doMock('./client', () => ({ ensureFreshAccessToken }));

    const { useAuthStore } = await import('../stores/authStore');
    useAuthStore.getState().setAccessToken('expired-token');

    const { getSocket } = await import('./realtime');
    getSocket();

    return {
      handlers,
      connect,
      disconnect,
      ensureFreshAccessToken,
      setActive: (value: boolean) => {
        socketStub.active = value;
      },
      useAuthStore,
    };
  }

  it("refreshes the token and reconnects on 'io server disconnect'", async () => {
    const { handlers, connect, ensureFreshAccessToken } = await setup();

    handlers.disconnect('io server disconnect');
    await flush();

    expect(ensureFreshAccessToken).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    // Order matters more than either call on its own: reconnecting with the token that just
    // expired is refused by the handshake, so a connect() before the refresh is not a revival.
    expect(ensureFreshAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
      connect.mock.invocationCallOrder[0]
    );
  });

  it("stays closed on 'io client disconnect' — that is our own sign-out", async () => {
    const { handlers, connect, ensureFreshAccessToken } = await setup();

    handlers.disconnect('io client disconnect');
    await flush();

    expect(ensureFreshAccessToken).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("leaves reasons socket.io retries by itself alone ('transport close')", async () => {
    const { handlers, connect, ensureFreshAccessToken } = await setup();

    handlers.disconnect('transport close');
    await flush();

    expect(ensureFreshAccessToken).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('does nothing when the store holds no token — there is no session left to revive', async () => {
    const { handlers, connect, ensureFreshAccessToken, useAuthStore } = await setup();
    useAuthStore.getState().clearSession();

    handlers.disconnect('io server disconnect');
    await flush();

    expect(ensureFreshAccessToken).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not reconnect when the refresh itself fails, and spawns no retry', async () => {
    const { handlers, connect, ensureFreshAccessToken } = await setup({ refreshFails: true });

    handlers.disconnect('io server disconnect');
    await flush();

    expect(ensureFreshAccessToken).toHaveBeenCalledTimes(1);
    // Never reaching connect() is what terminates this path: no connect means no further
    // disconnect/connect_error, so nothing re-enters revive().
    expect(connect).not.toHaveBeenCalled();
  });

  it('revives on a terminal connect_error but not on one socket.io is still retrying', async () => {
    const { handlers, connect, ensureFreshAccessToken, setActive } = await setup();

    setActive(true);
    handlers.connect_error(new Error('xhr poll error'));
    await flush();
    expect(ensureFreshAccessToken).not.toHaveBeenCalled();

    setActive(false);
    handlers.connect_error(new Error('UNAUTHORIZED'));
    await flush();
    expect(ensureFreshAccessToken).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('stops after a run of consecutive failures instead of looping forever', async () => {
    const { handlers, connect, ensureFreshAccessToken } = await setup();

    // A server that keeps refusing the handshake: every refused attempt is terminal on the client,
    // so without a cap this is an unbounded tight loop against the handshake rate limiter.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      handlers.connect_error(new Error('UNAUTHORIZED'));
      await flush();
    }

    expect(ensureFreshAccessToken).toHaveBeenCalledTimes(5);
    expect(connect).toHaveBeenCalledTimes(5);
  });

  it('clears the failure budget once a connection actually comes up', async () => {
    const { handlers, connect, ensureFreshAccessToken } = await setup();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      handlers.connect_error(new Error('UNAUTHORIZED'));
      await flush();
    }
    expect(connect).toHaveBeenCalledTimes(5);

    handlers.connect();

    handlers.disconnect('io server disconnect');
    await flush();
    expect(ensureFreshAccessToken).toHaveBeenCalledTimes(6);
    expect(connect).toHaveBeenCalledTimes(6);
  });

  // Finding 5: disconnectRealtime() only runs on the explicit Sign-out path, but clearSession() is
  // also called by client.ts's refresh-failure branch and by sessionRestore's catch. Without this
  // seam the socket outlives a revoked session on a still-unexpired access token.
  it('disconnects when the session is cleared by anything, not just sign-out', async () => {
    const { disconnect, useAuthStore } = await setup();
    expect(disconnect).not.toHaveBeenCalled();

    useAuthStore.getState().clearSession();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  // The other half of the same rule, and the one with real teeth. The subscription must key on the
  // non-null -> null TRANSITION, not on "the token changed": an ordinary refresh (the 401
  // interceptor's, or revive's own) rotates the token on a perfectly healthy socket. A "token
  // changed" implementation would disconnect it with reason 'io client disconnect' — which the
  // revival handler above deliberately never revives — reintroducing the exact permanent-death bug
  // this whole file exists to fix, by a different route.
  it('does NOT disconnect when the token is merely rotated by a refresh', async () => {
    const { disconnect, useAuthStore } = await setup();

    useAuthStore.getState().setAccessToken('rotated');

    expect(disconnect).not.toHaveBeenCalled();
  });
});
