import { useState, useCallback, useMemo } from "react";
import type { QRCode, QRCodeScan } from "@/shared/types";
import { listPostersFromBackend } from "@/shared/api/posters.api";
import { getScansFromBackend, normalizeBackendScan } from "@/shared/api/scans.api";
import { deletePosterFromBackend } from "@/features/qrcode/api/qrcode.api";

/**
 * Manages QR code poster and scan data. Does NOT auto-load on mount --
 * call `loadQRCodes()` explicitly from the consuming component's useEffect
 * so the side effect timing is visible and controllable at the call site.
 */
export function useMarketingData() {
  const [qrCodes, setQRCodes] = useState<QRCode[]>([]);
  const [scans, setScans] = useState<QRCodeScan[]>([]);
  const [loading, setLoading] = useState(true);

  const loadQRCodes = useCallback(async () => {
    setLoading(true);
    try {
      const [posters, scansList] = await Promise.all([
        listPostersFromBackend(),
        getScansFromBackend().then((list) => list.map(normalizeBackendScan)),
      ]);
      setQRCodes(posters);
      setScans(scansList);
    } catch (err) {
      console.error("Failed to load QR codes:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const deletePoster = useCallback(async (id: string) => {
    try {
      await deletePosterFromBackend(id);
      await loadQRCodes();
    } catch (err) {
      console.error("Failed to delete poster:", err);
    }
  }, [loadQRCodes]);

  const qrCodesWithStats = useMemo(() => {
    return qrCodes.map((qr) => {
      const qrScans = scans.filter((s) => s.qrCodeId === qr.id);
      const uniqueScans = new Set(qrScans.map((s) => s.sessionId || s.userId || s.id)).size;
      return {
        ...qr,
        totalScans: qrScans.length,
        uniqueScans,
      };
    });
  }, [qrCodes, scans]);

  return {
    qrCodesWithStats,
    loading,
    loadQRCodes,
    deletePoster,
  };
}
