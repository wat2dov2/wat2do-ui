import { useMemo } from "react";
import type { QRCodeScan } from "@/features/posters/types";

interface UseQRCodeStatsOptions {
  scans: QRCodeScan[];
  timeRange: string;
}

export function useQRCodeStats({ scans, timeRange }: UseQRCodeStatsOptions) {
  const filteredScans = useMemo(() => {
    if (timeRange === "all") return scans;

    const days = parseInt(timeRange);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return scans.filter(scan => new Date(scan.scannedAt) >= cutoffDate);
  }, [scans, timeRange]);

  const stats = useMemo(() => {
    const totalScans = filteredScans.length;
    return {
      totalScans,
      uniqueScans: new Set(filteredScans.map((scan) => scan.visitorReference)).size,
    };
  }, [filteredScans]);

  const chartData = useMemo(() => {
    const grouped = filteredScans.reduce((acc, scan) => {
      const scanDate = new Date(scan.scannedAt);
      const dateKey = scanDate.toISOString().split("T")[0];
      if (!acc[dateKey]) {
        acc[dateKey] = {
          total: 0,
          unique: new Set<string>(),
        };
      }
      acc[dateKey].total += 1;
      acc[dateKey].unique.add(scan.visitorReference);
      return acc;
    }, {} as Record<string, { total: number; unique: Set<string> }>);

    const dates = Object.keys(grouped).sort().map((date) => ({
      date,
      dateLabel: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    }));

    return {
      totalScansData: dates.map((date) => ({
        ...date,
        scans: grouped[date.date].total,
      })),
      uniqueScansData: dates.map((date) => ({
        ...date,
        scans: grouped[date.date].unique.size,
      })),
    };
  }, [filteredScans]);

  return {
    stats: {
      ...stats,
      ...chartData,
    },
  };
}
