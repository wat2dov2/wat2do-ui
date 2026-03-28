import { useMemo } from "react";
import type { QRCode, QRCodeScan } from "@/shared/types";

interface UseAdminPostersStatsOptions {
  qrCodes: QRCode[];
  allScans: QRCodeScan[];
}

/**
 * Hook for calculating stats in AdminPostersPage from backend posters and scans.
 */
export function useAdminPostersStats({ qrCodes, allScans }: UseAdminPostersStatsOptions) {
  const overallStats = useMemo(() => {
    let totalScans = 0;
    const uniqueScansSet = new Set<string>();

    qrCodes.forEach((qr) => {
      const scans = allScans.filter((s) => s.qrCodeId === qr.id);
      totalScans += scans.length;
      scans.forEach((scan) => {
        const id = scan.sessionId || scan.userId || scan.id;
        uniqueScansSet.add(id);
      });
    });

    return {
      totalScans,
      totalUniqueScans: uniqueScansSet.size,
      totalPosters: qrCodes.length,
    };
  }, [qrCodes, allScans]);

  return {
    overallStats,
  };
}
