/**
 * Scans API — data-fetching functions for QR code scans.
 */

import type { QRCodeScan } from "@/features/posters/types";
import type { ApiQrCodeScanResponse } from "@/shared/generated";
import { getPaginatedItems } from "@/shared/services/apiClient";

/** Scan row from GET /qr/scans. */
type QrCodeScanBackend = ApiQrCodeScanResponse;

/** Fetch scans from backend (so phone scans appear in dashboard). */
export async function getScansFromBackend(
  qrCodeId?: string,
): Promise<QrCodeScanBackend[]> {
  const url = qrCodeId ? `/qr/scans?qr_code_id=${encodeURIComponent(qrCodeId)}` : "/qr/scans";
  return getPaginatedItems<QrCodeScanBackend>(url);
}

/** Normalize backend scan to shared QRCodeScan shape. */
export function normalizeBackendScan(b: QrCodeScanBackend): QRCodeScan {
  return {
    id: b.id,
    qrCodeId: b.qr_code_id,
    scannedAt: b.scanned_at,
    userId: b.user_id ?? undefined,
    sessionId: b.session_id,
    conversionActions: b.conversion_actions,
    userAgent: b.user_agent ?? undefined,
  };
}
