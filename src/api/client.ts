import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api',
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retriedAfterRefresh?: boolean;
}

// Concurrent 401s share one in-flight refresh call rather than each firing their own.
let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post<{ accessToken: string }>('/auth/refresh')
      .then((res) => res.data.accessToken)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * Refreshes the access token on demand and stores it, OUTSIDE the 401 response interceptor.
 *
 * Exists for the realtime socket (src/api/realtime.ts), which has no 401 to react to: the API hangs
 * a socket up at the access token's expiry, and socket.io-client does not auto-reconnect from a
 * server-initiated disconnect — so the socket must be revived by hand, and reconnecting with the
 * SAME expired token just gets refused. Only the client can mint a new one, and only before it
 * reconnects.
 *
 * It reuses `refreshAccessToken`'s single-flight promise deliberately: a socket revival that
 * coincides with a 401 must produce ONE POST /auth/refresh, not two racing ones. Do not add a
 * second refresh path.
 *
 * Rejects if the refresh fails; callers must not retry (see realtime.ts's revive()).
 */
export async function ensureFreshAccessToken(): Promise<void> {
  useAuthStore.getState().setAccessToken(await refreshAccessToken());
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: { code?: string } }>) => {
    const config = error.config as RetryableRequestConfig | undefined;
    const isExpiredAccessToken =
      error.response?.status === 401 && error.response.data?.error?.code === 'INVALID_TOKEN';
    const isRefreshRequest = config?.url === '/auth/refresh';

    if (!isExpiredAccessToken || isRefreshRequest || !config || config._retriedAfterRefresh) {
      return Promise.reject(error);
    }

    config._retriedAfterRefresh = true;
    try {
      const accessToken = await refreshAccessToken();
      useAuthStore.getState().setAccessToken(accessToken);
      return apiClient(config);
    } catch (refreshError) {
      useAuthStore.getState().clearSession();
      return Promise.reject(refreshError);
    }
  }
);
