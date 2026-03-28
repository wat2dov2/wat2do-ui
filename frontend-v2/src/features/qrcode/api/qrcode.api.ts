/**
 * QR Code API
 * All poster and scan data from backend; no localStorage.
 */

import type { QRCode, QRCodeScan } from "@/shared/types";
import { api, ApiError } from "@/shared/services/apiClient";

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
      if (err.status === 202) return { requires_location: true };
      if (err.status === 404) return null;
    }
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
        window.location.href = `/?eventId=${config.destination_id}`;
      break;
    case "events-list":
      if (config.filters && typeof config.filters === "object") {
        window.location.href = `/?filters=${encodeURIComponent(JSON.stringify(config.filters))}`;
      } else {
        window.location.href = "/";
      }
      break;
    case "custom-url":
      if (config.destination_id != null && typeof config.destination_id === "string") {
        window.location.href = config.destination_id;
      }
      break;
    default:
      window.location.href = "/";
  }
}

/** Poster row from GET /qr/ or POST /qr/. */
export interface QrCodePosterBackend {
  id: string;
  name: string;
  description: string | null;
  destination_type: string;
  destination_id: string | null;
  filters: Record<string, unknown> | unknown[] | null;
  created_at: string;
  created_by: string;
  is_active: boolean;
  image_url: string | null;
  latitude: number;
  longitude: number;
}

/** Map backend poster to frontend QRCode. */
export function normalizeBackendPoster(b: QrCodePosterBackend): QRCode {
  return {
    id: b.id,
    name: b.name,
    description: b.description ?? undefined,
    destinationType: b.destination_type as QRCode["destinationType"],
    destinationId: b.destination_id != null ? (Number.isNaN(Number(b.destination_id)) ? b.destination_id : Number(b.destination_id)) : undefined,
    filters: b.filters ?? undefined,
    createdAt: b.created_at,
    createdBy: b.created_by,
    isActive: b.is_active,
    imageUrl: b.image_url ?? undefined,
    latitude: b.latitude,
    longitude: b.longitude,
  };
}

/** List all posters (auth). */
export async function listPostersFromBackend(): Promise<QRCode[]> {
  const list = await api.get<QrCodePosterBackend[]>("/qr/");
  return (list ?? []).map(normalizeBackendPoster);
}

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

/** Update poster (auth). */
export async function updatePosterToBackend(
  qrCodeId: string,
  payload: {
    name: string;
    description?: string | null;
    destination_type: string;
    destination_id?: string | number | null;
    filters?: Record<string, unknown> | unknown[] | null;
    created_by: string;
    is_active?: boolean;
    image_url?: string | null;
    latitude?: number;
    longitude?: number;
  },
): Promise<QRCode> {
  const body = {
    id: qrCodeId,
    name: payload.name,
    description: payload.description ?? null,
    destination_type: payload.destination_type,
    destination_id: payload.destination_id ?? null,
    filters: payload.filters ?? null,
    created_by: payload.created_by,
    is_active: payload.is_active ?? true,
    image_url: payload.image_url ?? null,
    latitude: payload.latitude ?? 0,
    longitude: payload.longitude ?? 0,
  };
  const b = await api.patch<QrCodePosterBackend>(`/qr/${encodeURIComponent(qrCodeId)}`, body);
  return normalizeBackendPoster(b);
}

/** Delete poster (auth). */
export async function deletePosterFromBackend(qrCodeId: string): Promise<void> {
  await api.delete(`/qr/${encodeURIComponent(qrCodeId)}`);
}

/** Scan row from GET /qr/scans. */
export interface QrCodeScanBackend {
  id: string;
  qr_code_id: string;
  scanned_at: string;
  user_id: string | null;
  session_id: string;
  conversion_actions: string[];
  user_agent: string | null;
}

/** Fetch scans from backend (so phone scans appear in dashboard). */
export async function getScansFromBackend(
  qrCodeId?: string,
): Promise<QrCodeScanBackend[]> {
  const url = qrCodeId ? `/qr/scans?qr_code_id=${encodeURIComponent(qrCodeId)}` : "/qr/scans";
  return api.get<QrCodeScanBackend[]>(url);
}

/** Normalize backend scan to shared QRCodeScan shape. */
export function normalizeBackendScan(b: QrCodeScanBackend): QRCodeScan {
  return {
    id: b.id,
    qrCodeId: b.qr_code_id,
    scannedAt: b.scanned_at,
    userId: b.user_id ?? undefined,
    sessionId: b.session_id,
    conversionActions: b.conversion_actions ?? [],
    userAgent: b.user_agent ?? undefined,
  };
}

