import { useState, useMemo } from "react";
import type { QRCode, QRCodeScan } from "@/shared/types";

type TimeFilter = "today" | "yesterday" | "last7days" | "last30days" | "alltime";

interface UsePostersFiltersOptions {
  refreshKey: number;
  /** Posters from backend (GET /qr/). */
  backendPosters: QRCode[];
  /** Scans from backend (GET /qr/scans). */
  backendScans: QRCodeScan[];
}

/**
 * Hook for managing filters on a posters page (time range, scan stats, QR code map).
 * Shared by admin and club-panel posters pages.
 */
export function usePostersFilters({
  refreshKey,
  backendPosters,
  backendScans,
}: UsePostersFiltersOptions) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("alltime");

  const qrCodes = useMemo(() => backendPosters, [refreshKey, backendPosters]);
  const allScans = useMemo(() => backendScans, [refreshKey, backendScans]);

  // Filter scans by time range
  const filteredScans = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    let endDate: Date | null = null;

    switch (timeFilter) {
      case "today":
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
        break;
      case "yesterday":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(0, 0, 0, 0);
        break;
      case "last7days":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "last30days":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "alltime":
      default:
        return allScans;
    }

    return allScans.filter((scan) => {
      const scanDate = new Date(scan.scannedAt);
      if (endDate) {
        return scanDate >= startDate && scanDate <= endDate;
      }
      return scanDate >= startDate;
    });
  }, [allScans, timeFilter]);

  // Calculate stats for each QR code (from allScans, which may be backend or localStorage)
  const qrCodesWithStats = useMemo(() => {
    return qrCodes.map((qr) => {
      const scans = allScans.filter((s) => s.qrCodeId === qr.id);
      const uniqueScans = new Set(scans.map((s) => s.sessionId || s.userId || s.id)).size;
      return {
        ...qr,
        totalScans: scans.length,
        uniqueScans,
      };
    });
  }, [qrCodes, allScans]);

  // Return all QR codes with stats (no search filter)
  const filteredQRCodes = qrCodesWithStats;

  // Return all filtered scans (no search filter)
  const scansMatchingPosterSearch = filteredScans;

  // Get QR code names for scans table
  const qrCodeMap = useMemo(() => {
    const map = new Map<string, string>();
    qrCodes.forEach((qr) => map.set(qr.id, qr.name));
    return map;
  }, [qrCodes]);

  return {
    timeFilter,
    setTimeFilter,
    qrCodes,
    qrCodesWithStats,
    filteredQRCodes,
    allScans,
    filteredScans,
    scansMatchingPosterSearch,
    qrCodeMap,
  };
}
