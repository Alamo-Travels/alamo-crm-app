import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { ensureFreshAccessToken } from './client';

/**
 * socket.io mounts at /socket.io on the API's ORIGIN, while VITE_API_URL points at the /api prefix
 * (and MUST keep its /api suffix — dropping it stops the browser sending the refresh cookie and
 * silently kills every session, see CLAUDE.md). Exactly ONE trailing /api is removed; an /api
 * appearing anywhere else in the URL is left alone.
 */
export function socketOrigin(apiUrl: string): string {
  return apiUrl.replace(/\/api\/?$/, '');
}

let socket: Socket | null = null;

/**
 * How many CONSECUTIVE revival attempts may be made before we give up until the next successful
 * connect. It is what keeps a pathological loop off the server's handshake rate-limiter budget: a
 * handshake the server keeps refusing (a deactivated user, a revoked session) is terminal on the
 * client, so each refusal would otherwise trigger another refresh-and-reconnect immediately, and
 * that spins as fast as the network allows for as long as the tab is open.
 */
const MAX_REVIVE_ATTEMPTS = 5;

/** Guards against two overlapping revivals (a disconnect and a connect_error can both land). */
let reviving = false;
let failedRevives = 0;

/**
 * Reconnects a socket THE CLIENT LIBRARY HAS ALREADY GIVEN UP ON, with a freshly-refreshed token.
 *
 * This is not a nicety — without it realtime dies permanently ~15 minutes after every page load.
 * The API hangs each socket up at its access token's expiry (alamo-crm-api's enquiryBridge.ts) via
 * `socket.disconnect(true)`, which puts a namespace DISCONNECT packet on the wire. socket.io-client
 * handles that by tearing the Manager down with `skipReconnect = true`, so `socket.active` goes
 * false and NO reconnect_attempt, connect_error or handshake ever follows — its own documentation
 * says of reason 'io server disconnect': "the disconnection was initiated by the server, you need
 * to manually reconnect." Measured against the installed 4.8.3: 0 reconnect attempts in 25s.
 *
 * REFRESHING BEFORE RECONNECTING IS THE LOAD-BEARING HALF. The socket died precisely because its
 * token expired, so reconnecting with the same token is refused by the handshake and lands right
 * back here. Only the client can mint a new token, and only the client knows to do it first — which
 * is why no server-side change can fix this on its own.
 */
async function revive(): Promise<void> {
  const current = socket;
  if (!current || reviving || failedRevives >= MAX_REVIVE_ATTEMPTS) return;
  // No token means there is no session left to revive — signed out, or a refresh already failed
  // and cleared it. Reconnecting would only be refused.
  if (!useAuthStore.getState().accessToken) return;

  reviving = true;
  failedRevives += 1;
  try {
    await ensureFreshAccessToken();
    current.connect();
  } catch {
    // Deliberately nothing, and deliberately not a retry.
    //
    // Note what does NOT terminate this: the session is not cleared. client.ts's response
    // interceptor short-circuits on `isRefreshRequest`, so a failing POST /auth/refresh rejects
    // WITHOUT calling clearSession() — the store keeps its stale token and the guard above would
    // happily let another revival through. What actually ends it is that we never reach connect():
    // no reconnect means no further disconnect or connect_error, so nothing re-enters revive().
    // MAX_REVIVE_ATTEMPTS is the backstop if some future caller re-enters it another way.
  } finally {
    reviving = false;
  }
}

export function getSocket(): Socket {
  if (!socket) {
    const created = io(socketOrigin(import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api'), {
      autoConnect: false,
      withCredentials: true,
      /**
       * THE CALLBACK FORM IS LOAD-BEARING — DO NOT REPLACE IT WITH A PLAIN OBJECT.
       *
       * socket.io re-invokes this on EVERY connection attempt, so it picks up the access token
       * revive() has just refreshed. The server hangs up each socket when its token expires
       * (~15 min), so reconnection is the normal steady state, not an error path.
       *
       * With `auth: { token }` evaluated once, every reconnect would replay the SAME expired token
       * forever and the socket would die permanently 15 minutes after sign-in — while looking
       * perfectly healthy for the first 15.
       */
      auth: (cb: (data: { token: string }) => void) =>
        cb({ token: useAuthStore.getState().accessToken ?? '' }),
    });
    socket = created;

    // A connection that actually came up clears the budget, so the cap only ever counts a run of
    // failures rather than accumulating over a long-lived tab.
    created.on('connect', () => {
      failedRevives = 0;
    });

    created.on('disconnect', (reason) => {
      // 'io client disconnect' is our own disconnectRealtime() on sign-out — stay closed.
      // 'io server disconnect' is the API's token-expiry hangup. socket.io-client does NOT
      // auto-reconnect from it (socket.active === false), so we must do it ourselves.
      // Every other reason ('transport close', 'ping timeout', …) leaves the library retrying on
      // its own, and racing it with a second connect() would be worse than leaving it alone.
      if (reason === 'io server disconnect') void revive();
    });

    created.on('connect_error', () => {
      // `active` still true means the library is mid-retry and will try again by itself. False
      // means it has given up — a handshake refused by the server's middleware ('UNAUTHORIZED'),
      // which is exactly what a stale token produces — and only a refresh can change the outcome.
      if (!created.active) void revive();
    });

    // Disconnect whenever the SESSION is cleared, not only on the explicit Sign-out path.
    // clearSession() is also called by client.ts's refresh-failure branch and by sessionRestore's
    // catch; without this the socket would outlive a revoked session, on a still-unexpired access
    // token, for up to that token's remaining lifetime.
    //
    // This is a store subscription rather than a disconnectRealtime() call inside client.ts BY
    // DESIGN: realtime.ts already imports client.ts for ensureFreshAccessToken, so importing
    // realtime.ts back into client.ts would close an import cycle between the two. Inverting it
    // through the store — which realtime.ts already depends on — keeps the dependency one-way, and
    // covers every caller of clearSession() including any added later.
    useAuthStore.subscribe((state, previous) => {
      if (previous.accessToken && !state.accessToken) created.disconnect();
    });
  }
  return socket;
}

/** Idempotent: socket.io ignores connect() on an already-connected socket. */
export function connectRealtime(): void {
  const s = getSocket();
  // An explicit connect is a fresh start (a new sign-in, a remount), so it clears any exhausted
  // revival budget left behind by a previous session's failures.
  failedRevives = 0;
  if (!s.connected) s.connect();
}

/**
 * Called on sign-out. Logout already revokes the session server-side; without this the socket would
 * outlive it on a still-unexpired access token.
 */
export function disconnectRealtime(): void {
  socket?.disconnect();
}
