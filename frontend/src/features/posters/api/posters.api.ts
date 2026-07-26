/**
 * Poster API - data-fetching functions for QR code posters.
 */

import type { QRCode } from "@/features/posters/types";
import type {
  ApiFilterStateResponse,
  ApiQrCodeCreate,
  ApiQrCodeResponse,
} from "@/shared/generated";
import { api, getPaginatedItems } from "@/shared/services/apiClient";
import { API_BASE_URL } from "@/shared/config/api";
import { stripTrailingSlash } from "@/shared/utils/string";
import { generatedFilterStateToFilterState } from "@/features/search/api/filterService";

/** Poster row from GET /qr/ or POST /qr/. */
type QrCodePosterBackend = ApiQrCodeResponse;

export type CreatePosterPayload =
  Omit<ApiQrCodeCreate, "latitude" | "longitude" | "program"> &
  Partial<Pick<ApiQrCodeCreate, "latitude" | "longitude" | "program">>;

function normalizePosterFilters(
  destinationType: QRCode["destinationType"],
  filters: QrCodePosterBackend["filters"],
): QRCode["filters"] {
  if (destinationType !== "events-list" || !filters || Array.isArray(filters)) {
    return undefined;
  }
  return generatedFilterStateToFilterState(filters as Partial<ApiFilterStateResponse>);
}

/** Map backend poster to frontend QRCode. */
function normalizeBackendPoster(b: QrCodePosterBackend): QRCode {
  const destinationType = b.destination_type;
  return {
    id: b.id,
    name: b.name,
    description: b.description ?? undefined,
    destinationType,
    destinationId: b.destination_id != null ? (Number.isNaN(Number(b.destination_id)) ? b.destination_id : Number(b.destination_id)) : undefined,
    filters: normalizePosterFilters(destinationType, b.filters),
    createdAt: b.created_at,
    createdBy: b.created_by,
    isActive: b.is_active,
    program: b.program,
    latestScan: b.latest_scan ?? undefined,
    imageUrl: b.image_url ?? undefined,
    latitude: b.latitude,
    longitude: b.longitude,
  };
}

/** List all posters (auth). */
export async function listPostersFromBackend(school?: string): Promise<QRCode[]> {
  const url = school ? `/qr/?school=${school}` : "/qr/";
  const list = await getPaginatedItems<QrCodePosterBackend>(url);
  return (list ?? []).map(normalizeBackendPoster);
}

/** Create a standard or promoter poster. New rows are immediately unarchived. */
export async function createPosterToBackend(payload: CreatePosterPayload): Promise<QRCode> {
  const body = {
    ...payload,
    description: payload.description ?? null,
    destination_id: payload.destination_id ?? null,
    filters: payload.filters ?? null,
    image_url: payload.image_url ?? null,
    latitude: payload.latitude ?? 0,
    longitude: payload.longitude ?? 0,
  };
  const poster = await api.post<QrCodePosterBackend>("/qr/", body);
  return normalizeBackendPoster(poster);
}

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
