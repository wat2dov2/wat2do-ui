/**
 * Poster API — shared data-fetching functions for QR code posters.
 *
 * Extracted from features/qrcode/api/qrcode.api.ts so that shared hooks
 * (useBackendPosters) do not depend on a feature module.
 */

import type { QRCode } from "@/shared/types";
import { api } from "@/shared/services/apiClient";

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
