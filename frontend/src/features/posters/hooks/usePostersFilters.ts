import { useState, useMemo } from "react";
import type { QRCode, QRCodeScan } from "@/features/posters/types";

export type TimeFilter = "today" | "yesterday" | "last7days" | "last30days" | "alltime";

interface UsePostersFiltersOptions {
  backendPosters: QRCode[];
  backendScans: QRCodeScan[];
}

export function usePostersFilters({
  backendPosters,
  backendScans,
}: UsePostersFiltersOptions) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("alltime");

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
        return backendScans;
    }

    return backendScans.filter((scan) => {
      const scanDate = new Date(scan.scannedAt);
      if (endDate) {
        return scanDate >= startDate && scanDate <= endDate;
      }
      return scanDate >= startDate;
    });
  }, [backendScans, timeFilter]);

  const qrCodeMap = useMemo(() => {
    return new Map(backendPosters.map((poster) => [poster.id, poster.name]));
  }, [backendPosters]);

  return {
    timeFilter,
    setTimeFilter,
    filteredScans,
    qrCodeMap,
  };
}
