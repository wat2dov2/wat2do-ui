import discoveryCache from "../../../../backend/controlbox/discovery_cache.json" with { type: "json" };

/**
 * The API's origin (`API_URL`), read by server code and by next.config.ts's
 * /api and /media rewrites, so every request reaches the same API.
 */
export function getServerApiBaseUrl(): string {
  return (process.env.API_URL?.trim() || "http://127.0.0.1:8000").replace(/\/$/, "");
}

/** Every public source read has a deadline, including complete response bodies. */
export function fetchServerSnapshot(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(discoveryCache.request_timeout_seconds * 1000),
  });
}
