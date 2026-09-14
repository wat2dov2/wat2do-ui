/**
 * Scans API - data-fetching functions for QR code scans.
 */

import type { QRCodeScan } from "@/features/posters/types";
import type { ApiQrCodeScanResponse } from "@/shared/generated";
import { getPaginatedItems } from "@/shared/services/apiClient";

/** Fetch scans from backend (so phone scans appear in dashboard). */
export async function getScansFromBackend(
  qrCodeId?: string,
): Promise<ApiQrCodeScanResponse[]> {
  const url = qrCodeId ? `/qr/scans?qr_code_id=${encodeURIComponent(qrCodeId)}` : "/qr/scans";
  return getPaginatedItems<ApiQrCodeScanResponse>(url);
}

/** Normalize backend scan to shared QRCodeScan shape. */
export function normalizeBackendScan(b: ApiQrCodeScanResponse): QRCodeScan {
  return {
    id: b.id,
    qrCodeId: b.qr_code_id,
    scannedAt: b.scanned_at,
    visitorReference: b.visitor_reference,
    browserFamily: b.browser_family ?? undefined,
    osFamily: b.os_family ?? undefined,
    asn: b.asn ?? undefined,
    country: b.country ?? undefined,
    landingConfirmedAt: b.landing_confirmed_at ?? undefined,
    riskScore: b.risk_score,
    riskFlags: b.risk_flags,
  };
}
