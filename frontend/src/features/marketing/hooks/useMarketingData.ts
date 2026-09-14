import { useState, useCallback, useMemo } from "react";
import type { QRCode, QRCodeScan } from "@/features/posters";
import { listPostersFromBackend } from "@/features/posters/api/posters.api";
import { getScansFromBackend, normalizeBackendScan } from "@/features/posters/api/scans.api";

/** Loads on demand so the caller controls when fetching starts. */
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
    const counts = new Map<string, { total: number; visitors: Set<string> }>();
    for (const scan of scans) {
      const count = counts.get(scan.qrCodeId) ?? { total: 0, visitors: new Set<string>() };
      count.total += 1;
      count.visitors.add(scan.visitorReference);
      counts.set(scan.qrCodeId, count);
    }

    return qrCodes.map((qr) => ({
      ...qr,
      totalScans: counts.get(qr.id)?.total ?? 0,
      uniqueScans: counts.get(qr.id)?.visitors.size ?? 0,
    }));
  }, [qrCodes, scans]);

  return {
    qrCodesWithStats,
    loading,
    loadQRCodes,
  };
}
