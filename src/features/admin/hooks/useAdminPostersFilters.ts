import { useState, useMemo, useCallback } from "react";
import { getQRCodes, getQRScans, getScansForQRCode } from "@/features/qrcode/api/qrcode.api";
import type { QRCode } from "@/shared/types";

type TimeFilter = "today" | "yesterday" | "last7days" | "last30days" | "alltime";

interface UseAdminPostersFiltersOptions {
  refreshKey: number;
}

/**
 * Hook for managing filters in AdminPostersPage
 */
export function useAdminPostersFilters({ refreshKey }: UseAdminPostersFiltersOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("alltime");

  // Get all QR codes
  const qrCodes = useMemo(() => {
    return getQRCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Get all scans
  const allScans = useMemo(() => {
    return getQRScans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

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

  // Calculate stats for each QR code
  const qrCodesWithStats = useMemo(() => {
    return qrCodes.map((qr) => {
      const scans = getScansForQRCode(qr.id);
      const uniqueScans = new Set(scans.map((s) => s.sessionId || s.userId || s.id)).size;
      return {
        ...qr,
        totalScans: scans.length,
        uniqueScans,
      };
    });
  }, [qrCodes]);

  // Filter QR codes
  const filteredQRCodes = useMemo(() => {
    return qrCodesWithStats.filter((qr) => {
      if (
        searchQuery &&
        !qr.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(qr.description || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    });
  }, [qrCodesWithStats, searchQuery]);

  // Filter scans by selected posters (search)
  const scansMatchingPosterSearch = useMemo(() => {
    if (!searchQuery) {
      return filteredScans;
    }

    const allowedIds = new Set(filteredQRCodes.map((qr) => qr.id));
    return filteredScans.filter((scan) => allowedIds.has(scan.qrCodeId));
  }, [filteredScans, filteredQRCodes, searchQuery]);

  // Get QR code names for scans table
  const qrCodeMap = useMemo(() => {
    const map = new Map<string, string>();
    qrCodes.forEach((qr) => map.set(qr.id, qr.name));
    return map;
  }, [qrCodes]);

  return {
    searchQuery,
    setSearchQuery,
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
