const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

export const API_BASE_URL =
  configuredApiUrl || (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "/api");
