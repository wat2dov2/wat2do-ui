/**
 * Poster API — shared data-fetching functions for QR code posters.
 *
 * Extracted from features/qrcode/api/qrcode.api.ts so that shared hooks
 * (useBackendPosters) do not depend on a feature module.
 */

import type { QRCode } from "@/shared/types";
import type { ApiQrCodeResponse } from "@/shared/generated";
import { getPaginatedItems } from "@/shared/services/apiClient";

/** Poster row from GET /qr/ or POST /qr/. */
export type QrCodePosterBackend = ApiQrCodeResponse;

/** Map backend poster to frontend QRCode. */
export function normalizeBackendPoster(b: QrCodePosterBackend): QRCode {
  return {
    id: b.id,
    name: b.name,
    description: b.description ?? undefined,
    destinationType: b.destination_type as QRCode["destinationType"],
    destinationId: b.destination_id != null ? (Number.isNaN(Number(b.destination_id)) ? b.destination_id : Number(b.destination_id)) : undefined,
    // The backend stores ``filters`` as opaque JSON (``Record<string,
    // unknown> | unknown[] | null``); the frontend's QRCode type
    // narrows it to FilterState. The "events-list" destination type
    // is the only branch that reads filters as FilterState — every
    // other destination ignores the field. Cast through unknown so
    // we don't lose runtime data while satisfying the narrower type.
    filters: (b.filters ?? undefined) as unknown as QRCode["filters"],
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
  const list = await getPaginatedItems<QrCodePosterBackend>("/qr/");
  return (list ?? []).map(normalizeBackendPoster);
}
