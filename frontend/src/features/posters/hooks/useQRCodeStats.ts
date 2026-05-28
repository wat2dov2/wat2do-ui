import { useMemo } from "react";
import type { QRCodeScan } from "@/features/posters/types";

interface UseQRCodeStatsOptions {
  scans: QRCodeScan[];
  timeRange: string;
}

/**
 * Hook for calculating QR code statistics
 */
export function useQRCodeStats({ scans, timeRange }: UseQRCodeStatsOptions) {
  // Filter scans based on time range
  const filteredScans = useMemo(() => {
    if (timeRange === "all") return scans;
    
    const days = parseInt(timeRange);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    return scans.filter(scan => new Date(scan.scannedAt) >= cutoffDate);
  }, [scans, timeRange]);

  // Calculate stats
  const stats = useMemo(() => {
    const totalScans = filteredScans.length;
    const uniqueScansSet = new Set(
      filteredScans.map((s) => s.sessionId || s.userId || s.id)
    );
    const uniqueScans = uniqueScansSet.size;
    const conversions = filteredScans.filter((s) => s.conversionActions.length > 0)
      .length;
    const conversionRate =
      totalScans > 0 ? ((conversions / totalScans) * 100).toFixed(1) : "0.0";

    return {
      totalScans,
      uniqueScans,
      conversions,
      conversionRate,
    };
  }, [filteredScans]);

  // Group scans by date for time series charts and generate chart data
  const chartData = useMemo(() => {
    const grouped = filteredScans.reduce((acc, scan) => {
      const scanDate = new Date(scan.scannedAt);
      const dateKey = scanDate.toISOString().split('T')[0];
      if (!acc[dateKey]) {
        acc[dateKey] = {
          total: 0,
          unique: new Set<string>(),
          conversions: 0,
        };
      }
      acc[dateKey].total += 1;
      acc[dateKey].unique.add(scan.sessionId || scan.userId || scan.id);
      if (scan.conversionActions.length > 0) {
        acc[dateKey].conversions += 1;
      }
      return acc;
    }, {} as Record<string, { total: number; unique: Set<string>; conversions: number }>);

    // Generate chart data for each metric
    const allDates = Object.keys(grouped).sort();
    const totalScansData = allDates.map((dateKey) => {
      const date = new Date(dateKey);
      return {
        date: dateKey,
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        scans: grouped[dateKey].total,
      };
    });

    const uniqueScansData = allDates.map((dateKey) => {
      const date = new Date(dateKey);
      return {
        date: dateKey,
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        scans: grouped[dateKey].unique.size,
      };
    });

    const conversionsData = allDates.map((dateKey) => {
      const date = new Date(dateKey);
      return {
        date: dateKey,
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        conversions: grouped[dateKey].conversions,
      };
    });

    const conversionRateData = allDates.map((dateKey) => {
      const date = new Date(dateKey);
      const dayData = grouped[dateKey];
      const rate = dayData.total > 0 
        ? ((dayData.conversions / dayData.total) * 100).toFixed(1)
        : "0.0";
      return {
        date: dateKey,
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        rate: parseFloat(rate),
      };
    });

    return {
      totalScansData,
      uniqueScansData,
      conversionsData,
      conversionRateData,
    };
  }, [filteredScans]);

  return {
    filteredScans,
    stats: {
      ...stats,
      ...chartData,
    },
  };
}
