export function getServerApiBaseUrl(): string {
  const configuredBackendApiUrl = process.env.BACKEND_API_URL?.trim();
  if (configuredBackendApiUrl) return configuredBackendApiUrl.replace(/\/$/, "");

  const configuredPublicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configuredPublicApiUrl?.startsWith("http://") || configuredPublicApiUrl?.startsWith("https://")) {
    return configuredPublicApiUrl.replace(/\/$/, "");
  }

  return "http://127.0.0.1:8000";
}
