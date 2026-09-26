import discoveryCache from "../../../../backend/controlbox/discovery_cache.json" with { type: "json" };

export function getServerApiBaseUrl(): string {
  const configuredBackendApiUrl = process.env.BACKEND_API_URL?.trim();
  if (configuredBackendApiUrl)
    return configuredBackendApiUrl.replace(/\/$/, "");

  const configuredPublicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (
    configuredPublicApiUrl?.startsWith("http://") ||
    configuredPublicApiUrl?.startsWith("https://")
  ) {
    return configuredPublicApiUrl.replace(/\/$/, "");
  }

  return "http://127.0.0.1:8000";
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
