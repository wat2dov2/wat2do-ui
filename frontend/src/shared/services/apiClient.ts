import { API_BASE_URL } from "@/shared/config/api";

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

interface TokenRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
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
 */
export function handleAuthFailure(): void {
  clearAccessToken();
  // Only redirect if not already on the login page
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };

  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const fetchOptions: RequestInit = { ...options, headers };

  // Send cookies for auth endpoints (httpOnly refresh token cookie)
  if (path.startsWith("/auth/")) {
    fetchOptions.credentials = "include";
  }

  const res = await fetch(url, fetchOptions);

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch((err) => { console.error("Failed to parse API response JSON:", err); return null; });

  if (!res.ok) {
    // On 401, attempt to refresh the token and retry — but not for auth
    // endpoints themselves (to avoid infinite loops on /auth/refresh failures).
    if (res.status === 401 && !path.startsWith("/auth/")) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry the original request with the new token
        const retryHeaders: Record<string, string> = {
          ...headers,
          Authorization: `Bearer ${getAccessToken()}`,
        };
        const retryRes = await fetch(url, { ...options, headers: retryHeaders });

        if (retryRes.status === 204) return undefined as T;

        const retryBody = await retryRes.json().catch((err) => {
          console.error("Failed to parse retry response JSON:", err);
          return null;
        });

        if (!retryRes.ok) {
          throw new ApiError(retryRes.status, retryBody);
        }
        return retryBody as T;
      }

      // Refresh failed — session is dead
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
