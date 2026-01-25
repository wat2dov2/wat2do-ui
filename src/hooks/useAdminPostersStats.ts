import { useMemo } from "react";
import { getScansForQRCode } from "@/utils/qrRedirect";
import type { QRCode } from "@/types";

interface UseAdminPostersStatsOptions {
  qrCodes: QRCode[];
}

/**
 * Hook for calculating stats in AdminPostersPage
 */
export function useAdminPostersStats({ qrCodes }: UseAdminPostersStatsOptions) {
  // Calculate overall stats
  const overallStats = useMemo(() => {
    let totalScans = 0;
    let totalUniqueScans = 0;
    const uniqueScansSet = new Set<string>();

    qrCodes.forEach((qr) => {
      const scans = getScansForQRCode(qr.id);
      totalScans += scans.length;
      scans.forEach((scan) => {
        const id = scan.sessionId || scan.userId || scan.id;
        uniqueScansSet.add(id);
      });
    });

    totalUniqueScans = uniqueScansSet.size;

    return {
      totalScans,
      totalUniqueScans,
      totalPosters: qrCodes.length,
    };
  }, [qrCodes]);

  return {
    overallStats,
  };
}
