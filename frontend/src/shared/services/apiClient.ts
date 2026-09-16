import type { ApiTokenResponse } from "@/shared/generated";
import type { components } from "@/shared/generated/api-types";
import { API_BASE_URL } from "@/shared/config/api";
import { StorageService } from "@/shared/services/storageService";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";

// In-memory access token - never stored in localStorage
let accessToken: string | null = null;
let authSessionInvalid = false;
let authFailureNotified = false;
const AUTH_STATE_REFRESH_EVENT = "auth-state-refresh";

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
  authSessionInvalid = false;
  authFailureNotified = false;
}

export function clearAccessToken(): void {
  accessToken = null;
}

class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    let msg = `Request failed with status ${status}`;
    if (typeof body === "object" && body !== null && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail
          .map((d) => {
            if (typeof d === "object" && d !== null) {
              const item = d as { loc?: unknown; msg?: unknown };
              const loc = Array.isArray(item.loc) ? item.loc.join(".") : "";
              const field = loc ? `[${loc}] ` : "";
              return `${field}${typeof item.msg === "string" ? item.msg : "Invalid value"}`;
            }
            return "Invalid value";
          })
          .join(", ");
      }
    }
    super(msg);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function getApiErrorMessage(
  err: unknown,
  defaultMessage = "An unexpected error occurred"
): string {
  if (isApiError(err)) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return defaultMessage;
}

// ── 401 Retry / Token Refresh ───────────────────────────────────────
//
// When a request returns 401, we attempt a single token refresh via the
// httpOnly cookie and retry the original request. A shared promise
// prevents concurrent refresh calls - all in-flight 401s wait on the
// same refresh attempt.

let refreshPromise: Promise<RefreshOutcome> | null = null;

const AUTH_CREDENTIAL_PATHS = new Set([
  "/auth/refresh",
  "/auth/logout",
  "/auth/verify-otp",
]);

/** The authoritative result of attempting to rotate the current session. */
type RefreshOutcome = "refreshed" | "rejected" | "unreachable";

/**
 * Optional hook invoked after a successful silent access-token refresh and
 * successful retry of the original request. Waiting for the retry matters:
 * if the backend still rejects the fresh token, re-fetching /users/me here
 * would recursively create another refresh cycle.
 *
 * Lives here (not in auth.api.ts) to avoid an import cycle - auth.api.ts
 * already depends on apiClient.
 */
let onAfterRefresh: (() => void) | null = null;

export function setOnAfterRefresh(fn: (() => void) | null): void {
  onAfterRefresh = fn;
}

function notifyAfterSuccessfulRefresh(): void {
  try {
    onAfterRefresh?.();
  } catch (err) {
    console.error("onAfterRefresh hook threw:", err);
  }
}

/**
 * Attempt to refresh the access token. The refresh endpoint uses 401 when the
 * cookie is missing or expired; other failures leave the session intact so a
 * deploy, origin misconfiguration, or rate limit cannot log the user out.
 * Concurrent callers share one in-flight request. Exported for startup auth
 * and raw upload requests.
 */
export function refreshAccessToken(): Promise<RefreshOutcome> {
  if (authSessionInvalid) return Promise.resolve("rejected");
  if (refreshPromise) return refreshPromise;

  const doRefresh = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // send the httpOnly refresh cookie
      });

      if (!res.ok) {
        return res.status === 401 ? "rejected" : "unreachable";
      }

      const data: ApiTokenResponse = await res.json();
      setAccessToken(data.access_token);
      return "refreshed" as const;
    } catch (err) {
      console.error("Token refresh request failed:", err);
      return "unreachable" as const;
    }
  };

  refreshPromise = (async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.locks) {
        return await navigator.locks.request("auth-refresh", doRefresh);
      }
      return await doRefresh();
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Called when token refresh fails - clears stale local auth state and notifies
 * subscribers. ProtectedRoute handles navigation for protected pages; public
 * pages should not be yanked to login by a background/auth-gated request.
 * Exported for use by uploadService which makes raw fetch calls.
 *
 * Skips the redirect when there's no cached email, since that means the
 * user was never logged in (or was already cleared by initializeAuth's
 * refresh failure) - bouncing an anonymous visitor from a public page to
 * /login on the first auth-gated fetch is a bad UX.
 */
export function handleAuthFailure(): void {
  authSessionInvalid = true;
  clearAccessToken();
  StorageService.removeItem(STORAGE_KEYS.USER_EMAIL);
  StorageService.removeItem(STORAGE_KEYS.USER_PROFILE);
  if (authFailureNotified) return;
  authFailureNotified = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_STATE_REFRESH_EVENT));
    window.dispatchEvent(new Event("auth-user-logout"));
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
  // from the response unless credentials is "include" - so login/signup
  // need this to *receive* the cookie, refresh needs it to send+rotate,
  // and logout/reset-password need it for the Set-Cookie that clears it.
  // The cookie's path=/auth/refresh scope still prevents it from being
  // attached to any of these other endpoints.
  if (AUTH_CREDENTIAL_PATHS.has(path) || path.startsWith("/qr/")) {
    fetchOptions.credentials = "include";
  }

  const res = await fetch(url, fetchOptions);

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch((err) => { console.error("Failed to parse API response JSON:", err); return null; });

  if (!res.ok) {
    if (
      res.status === 401 &&
      !path.startsWith("/auth/")
    ) {
      if (!authSessionInvalid && retryCount === 0) {
        const refreshOutcome = await refreshAccessToken();
        if (refreshOutcome === "refreshed" && !authSessionInvalid) {
          const result = await request<T>(path, options, retryCount + 1);
          notifyAfterSuccessfulRefresh();
          return result;
        }
        if (refreshOutcome === "unreachable") {
          throw new ApiError(res.status, body);
        }
      }

      // Only call handleAuthFailure() for core/session-verifying endpoints.
      // If a background/secondary endpoint (e.g. /going-events/) fails with 401,
      // we still throw the ApiError normally but do NOT clear the user session.
      const isCoreSessionEndpoint =
        path === "/users/me" ||
        path === "/users/me/profile";
      if (isCoreSessionEndpoint) {
        handleAuthFailure();
      }
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

export type PaginatedApiResponse<T> = Omit<components["schemas"]["PaginatedResponse_EventSummaryResponse_"], "items"> & { items: T[] };

const MAX_BACKEND_PAGE_SIZE = 100;

function withPaginationParams(path: string, page: number, pageSize: number): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}page=${page}&page_size=${pageSize}`;
}

export async function getPaginatedItems<T>(
  path: string,
  pageSize = MAX_BACKEND_PAGE_SIZE,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  while (true) {
    const response = await api.get<PaginatedApiResponse<T>>(
      withPaginationParams(path, page, pageSize),
    );
    items.push(...response.items);

    if (response.page >= response.total_pages || response.items.length === 0) {
      return items;
    }
    page = response.page + 1;
  }
}

export { ApiError };
