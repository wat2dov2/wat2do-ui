/**
 * QR Code API
 * All poster and scan data from backend; no localStorage.
 */

import type { QRCode } from "@/shared/types";
import { api, ApiError } from "@/shared/services/apiClient";
import { isSafeUrl } from "@/shared/utils/url";
import { API_BASE_URL } from "@/shared/config/api";
import { stripTrailingSlash } from "@/shared/utils/string";
import { ROUTES } from "@/shared/constants/routes";
import type { QrCodePosterBackend } from "@/shared/api/posters.api";
import { normalizeBackendPoster } from "@/shared/api/posters.api";

/** Response from GET /qr/{id}: backend records the scan and returns redirect config. */
export interface QrRedirectConfig {
  destination_type: string;
  destination_id: string | number | null;
  filters: Record<string, unknown> | unknown[] | null;
}

/** Result of fetchQrRedirectFromBackend: config to redirect, requires_location for first scan, or null if not found. */
export type QrRedirectResult = QrRedirectConfig | { requires_location: true } | null;

/** Fetch redirect config from backend; backend records the scan. Returns requires_location when poster is inactive and needs lat/lon. */
export async function fetchQrRedirectFromBackend(qrCodeId: string): Promise<QrRedirectResult> {
  try {
    const data = await api.get<QrRedirectConfig>(`/qr/${encodeURIComponent(qrCodeId)}`);
    return data;
  } catch (err) {
    if (err instanceof ApiError) {
      // Backend returns 400 {"detail": "requires_location"} when the poster
      // is inactive and needs geolocation to activate. Match this precisely
      // so unrelated 400s still bubble up as errors.
      if (
        err.status === 400 &&
        typeof err.body === "object" &&
        err.body !== null &&
        "detail" in err.body &&
        (err.body as { detail?: string }).detail === "requires_location"
      ) {
        return { requires_location: true };
      }
      if (err.status === 404) return null;
    }
    console.error("Failed to fetch QR redirect config:", err);
    throw err;
  }
}

/** First scan: send location so backend can activate poster and record scan. Returns redirect config. */
export async function fetchQrRedirectWithLocation(
  qrCodeId: string,
  latitude: number,
  longitude: number,
): Promise<QrRedirectConfig> {
  const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
  return api.get<QrRedirectConfig>(`/qr/${encodeURIComponent(qrCodeId)}?${params}`);
}

/** Redirect the browser using backend config (after scan was recorded). */
export function redirectFromConfig(config: QrRedirectConfig): void {
  switch (config.destination_type) {
    case "event":
      if (config.destination_id != null)
        window.location.href = `${ROUTES.HOME}?eventId=${config.destination_id}`;
      break;
    case "events-list":
      if (config.filters && typeof config.filters === "object") {
        window.location.href = `${ROUTES.HOME}?filters=${encodeURIComponent(JSON.stringify(config.filters))}`;
      } else {
        window.location.href = ROUTES.HOME;
      }
      break;
    case "custom-url":
      if (config.destination_id != null && typeof config.destination_id === "string") {
        if (isSafeUrl(config.destination_id)) {
          window.location.href = config.destination_id;
        } else {
          console.error("Blocked unsafe redirect URL:", config.destination_id);
          window.location.href = ROUTES.HOME;
        }
      }
      break;
    default:
      window.location.href = ROUTES.HOME;
  }
}

// Poster types and list function are defined in shared/api/posters.api.ts
// and re-exported here for backward compatibility.
export { listPostersFromBackend } from "@/shared/api/posters.api";

/** Create poster (auth). New poster is inactive until first scan provides location. */
export async function createPosterToBackend(payload: {
  id: string;
  name: string;
  description?: string | null;
  destination_type: string;
  destination_id?: string | number | null;
  filters?: Record<string, unknown> | unknown[] | null;
  created_by: string;
  is_active?: boolean;
  image_url?: string | null;
}): Promise<QRCode> {
  const body = {
    id: payload.id,
    name: payload.name,
    description: payload.description ?? null,
    destination_type: payload.destination_type,
    destination_id: payload.destination_id ?? null,
    filters: payload.filters ?? null,
    created_by: payload.created_by,
    is_active: payload.is_active ?? true,
    image_url: payload.image_url ?? null,
    latitude: 0,
    longitude: 0,
  };
  const b = await api.post<QrCodePosterBackend>("/qr/", body);
  return normalizeBackendPoster(b);
}

/** Delete poster (auth). */
export async function deletePosterFromBackend(qrCodeId: string): Promise<void> {
  await api.delete(`/qr/${encodeURIComponent(qrCodeId)}`);
}

// Scan types and functions are defined in shared/api/scans.api.ts
// and re-exported here for backward compatibility.
export { getScansFromBackend } from "@/shared/api/scans.api";

/**
 * Resolve a poster image URL to an absolute URL.
 * If the imageUrl is already absolute (http/https) or a data URI, returns it as-is.
 * Otherwise, prepends API_BASE_URL, normalizing slashes.
 */
export function getQRImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith("http") || imageUrl.startsWith("data:")) {
    return imageUrl;
  }
  const base = stripTrailingSlash(API_BASE_URL);
  const path = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
  return `${base}${path}`;
}

