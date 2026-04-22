import { API_BASE_URL } from "@/shared/config/api";
import { StorageService } from "@/shared/services/storageService";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";

// In-memory access token — never stored in localStorage
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const msg = typeof body === "object" && body !== null && "detail" in body
      ? String((body as { detail: string }).detail)
      : `Request failed with status ${status}`;
    super(msg);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// ── 401 Retry / Token Refresh ───────────────────────────────────────
//
// When a request returns 401, we attempt a single token refresh via the
// httpOnly cookie and retry the original request. A shared promise
// prevents concurrent refresh calls — all in-flight 401s wait on the
// same refresh attempt.

let refreshPromise: Promise<boolean> | null = null;

const AUTH_CREDENTIAL_PATHS = new Set([
  "/auth/signup",
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/auth/reset-password",
]);

interface TokenRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
}

/**
 * Optional hook invoked after a successful silent access-token refresh.
 * The auth feature installs this at app startup so a silent 401 retry
 * also re-fetches /users/me, which keeps cached role/hasClub in sync with
 * the backend when a session quietly rotates after hours of idle time.
 *
 * Lives here (not in auth.api.ts) to avoid an import cycle — auth.api.ts
 * already depends on apiClient.
 */
let onAfterRefresh: (() => void) | null = null;

export function setOnAfterRefresh(fn: (() => void) | null): void {
  onAfterRefresh = fn;
}

/**
 * Attempt to refresh the access token. Returns true if a new token was
 * obtained, false otherwise. Concurrent callers share one in-flight request.
 * Exported for use by uploadService which makes raw fetch calls.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // send the httpOnly refresh cookie
      });

      if (!res.ok) return false;

      const data: TokenRefreshResponse = await res.json();
      setAccessToken(data.access_token);
      try {
        onAfterRefresh?.();
      } catch (err) {
        console.error("onAfterRefresh hook threw:", err);
      }
      return true;
    } catch (err) {
      console.error("Token refresh request failed:", err);
      return false;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

/**
 * Called when token refresh fails — clears in-memory token and redirects
 * to login. Uses window.location so it works outside of React Router.
 * Exported for use by uploadService which makes raw fetch calls.
 *
 * Skips the redirect when there's no cached email, since that means the
 * user was never logged in (or was already cleared by initializeAuth's
 * refresh failure) — bouncing an anonymous visitor from a public page to
 * /login on the first auth-gated fetch is a bad UX.
 */
export function handleAuthFailure(): void {
  clearAccessToken();
  const hasCachedEmail =
    StorageService.getItem<string | null>(STORAGE_KEYS.USER_EMAIL, null) !== null;
  if (!hasCachedEmail) return;
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

/**
 * Check whether the request URL's origin matches the configured API origin.
 * Only when origins match do we attach the in-memory access token. This
 * prevents leaking the Bearer token to a misconfigured / attacker-controlled
 * API_BASE_URL or a full-URL path accidentally passed to `request`.
 */
function sameOriginAsApi(targetUrl: string): boolean {
  try {
    const target = new URL(targetUrl, window.location.origin);
    const api = new URL(API_BASE_URL, window.location.origin);
    return target.origin === api.origin;
  } catch (err) {
    console.error("Failed to parse URL for origin comparison:", err);
    return false;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryCount = 0,
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };

  const token = getAccessToken();
  if (token && sameOriginAsApi(url)) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const fetchOptions: RequestInit = { ...options, headers };

  // Include credentials on every endpoint that sets, reads, or clears the
  // refresh cookie. For cross-origin requests the browser drops Set-Cookie
  // from the response unless credentials is "include" — so login/signup
  // need this to *receive* the cookie, refresh needs it to send+rotate,
  // and logout/reset-password need it for the Set-Cookie that clears it.
  // The cookie's path=/auth/refresh scope still prevents it from being
  // attached to any of these other endpoints.
  if (AUTH_CREDENTIAL_PATHS.has(path)) {
    fetchOptions.credentials = "include";
  }

  const res = await fetch(url, fetchOptions);

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch((err) => { console.error("Failed to parse API response JSON:", err); return null; });

  if (!res.ok) {
    if (
      res.status === 401 &&
      !path.startsWith("/auth/") &&
      retryCount === 0
    ) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return request<T>(path, options, retryCount + 1);
      }
      handleAuthFailure();
    }

    throw new ApiError(res.status, body);
  }

  return body as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: "GET" });
  },

  post<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: data != null ? JSON.stringify(data) : undefined,
    });
  },

  patch<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      body: data != null ? JSON.stringify(data) : undefined,
    });
  },

  put<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PUT",
      body: data != null ? JSON.stringify(data) : undefined,
    });
  },

  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
};

export { ApiError };
