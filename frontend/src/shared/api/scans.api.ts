/**
 * Scans API — shared data-fetching functions for QR code scans.
 *
 * Extracted from features/qrcode/api/qrcode.api.ts so that shared hooks
 * (useBackendScans) do not depend on a feature module.
 */

import type { QRCodeScan } from "@/shared/types";
import { api } from "@/shared/services/apiClient";

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
