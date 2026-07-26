import { useState, useCallback, useMemo } from "react";
import type { QRCode, QRCodeScan } from "@/features/posters";
import { listPostersFromBackend } from "@/features/posters/api/posters.api";
import { getScansFromBackend, normalizeBackendScan } from "@/features/posters/api/scans.api";

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

  const qrCodesWithStats = useMemo(() => {
    return qrCodes.map((qr) => {
      const qrScans = scans.filter((s) => s.qrCodeId === qr.id);
      const uniqueScans = new Set(qrScans.map((s) => s.visitorReference)).size;
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
  };
}
