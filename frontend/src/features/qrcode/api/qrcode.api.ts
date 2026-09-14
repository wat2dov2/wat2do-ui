/**
 * QR Code API
 * Public QR redirect API.
 */

import type { ApiQrCodeRedirect } from "@/shared/generated";
import { api, isApiError } from "@/shared/services/apiClient";
import { isSafeUrl } from "@/shared/utils/url";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";
import { StorageService } from "@/shared/services/storageService";
import {
  normalizeFilterState,
  stagePendingFilterState,
} from "@/features/search/api/filterService";

/** Response from GET /qr/{id}: backend records the scan and returns redirect config. */
export type QrRedirectConfig = ApiQrCodeRedirect;

/** Resolve to redirect config, an unplaced-poster location retry, or not found. */
export type QrRedirectResult = QrRedirectConfig | { requires_location: true } | null;

interface PosterScanConfirmation {
  token: string;
  posterId: string;
}

/** Fetch redirect config and record the scan, retrying when an unplaced poster needs location. */
export async function fetchQrRedirectFromBackend(qrCodeId: string): Promise<QrRedirectResult> {
  try {
    const data = await api.get<QrRedirectConfig>(`/qr/${encodeURIComponent(qrCodeId)}`);
    return data;
  } catch (err) {
    if (isApiError(err)) {
      // Backend returns 400 {"detail": "requires_location"} when the poster
      // is unplaced and needs a geolocation attempt. Match this precisely
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

/** Retry an unplaced poster scan with coordinates and return its redirect config. */
export async function fetchQrRedirectWithLocation(
  qrCodeId: string,
  latitude: number,
  longitude: number,
): Promise<QrRedirectConfig> {
  const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
  return api.get<QrRedirectConfig>(`/qr/${encodeURIComponent(qrCodeId)}?${params}`);
}

function appendRedirectQueryParams(
  destination: string,
  queryParams: QrRedirectConfig["query_params"],
): string {
  if (!queryParams) return destination;
  const url = new URL(destination, window.location.origin);
  Object.entries(queryParams).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.origin === window.location.origin
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
}

function eventsListDestination(filters: QrRedirectConfig["filters"]): string {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return ROUTES.HOME;
  }

  const school = (filters as Record<string, unknown>).school;
  if (typeof school !== "string" || !school.trim()) {
    return ROUTES.HOME;
  }

  return `${ROUTES.HOME}?${new URLSearchParams({
    [QP.SCHOOL]: school.trim(),
  })}`;
}

function stagePosterScanConfirmation(config: QrRedirectConfig): void {
  const token = config.scan_confirmation_token;
  const posterId = config.query_params?.[QP.POSTER_ID];
  if (!token || !posterId) {
    return;
  }

  StorageService.setSessionItem<PosterScanConfirmation>(
    STORAGE_KEYS.POSTER_SCAN_CONFIRMATION,
    {
      token,
      posterId,
    },
  );
}

export function loadPosterScanConfirmation(): PosterScanConfirmation | null {
  return StorageService.getSessionItem<PosterScanConfirmation | null>(
    STORAGE_KEYS.POSTER_SCAN_CONFIRMATION,
    null,
  );
}

export function clearPosterScanConfirmation(token: string): void {
  const staged = loadPosterScanConfirmation();
  if (staged?.token === token) {
    StorageService.removeSessionItem(STORAGE_KEYS.POSTER_SCAN_CONFIRMATION);
  }
}

export async function confirmPosterLanding(token: string): Promise<void> {
  await api.post("/qr/scans/confirm", { token });
}

/** Redirect the browser using backend config (after scan was recorded). */
export function redirectFromConfig(config: QrRedirectConfig): void {
  stagePosterScanConfirmation(config);

  switch (config.destination_type) {
    case "event":
      if (config.destination_id != null)
        window.location.href = appendRedirectQueryParams(
          eventPagePath(Number(config.destination_id)),
          config.query_params,
        );
      break;
    case "events-list":
      if (config.filters && typeof config.filters === "object" && !Array.isArray(config.filters)) {
        stagePendingFilterState(
          normalizeFilterState(
            config.filters as Record<string, unknown>,
          ),
        );
      }
      window.location.href = appendRedirectQueryParams(
        eventsListDestination(config.filters),
        config.query_params,
      );
      break;
    case "custom-url":
      if (config.destination_id != null && typeof config.destination_id === "string") {
        if (isSafeUrl(config.destination_id)) {
          window.location.href = appendRedirectQueryParams(
            config.destination_id,
            config.query_params,
          );
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
