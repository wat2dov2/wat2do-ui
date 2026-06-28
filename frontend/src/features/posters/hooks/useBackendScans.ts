import {
  getScansFromBackend,
  normalizeBackendScan,
} from "@/features/posters/api/scans.api";
import type { QRCodeScan } from "@/features/posters/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";

/**
 * Fetches scans from the backend so that scans from any device (e.g. phone)
 * appear in the dashboard. Returns normalized QRCodeScan[] and loading state.
 */
export function useBackendScans(refreshKey?: number): {
  scans: QRCodeScan[];
  loading: boolean;
  error: Error | null;
} {
  const { data: scans = [], isLoading, error } = useQuery({
    queryKey: queryKeys.scans.list(refreshKey),
    queryFn: () => getScansFromBackend().then((raw) => raw.map(normalizeBackendScan)),
    placeholderData: [] as QRCodeScan[],
  });

  return { scans, loading: isLoading, error: error instanceof Error ? error : error ? new Error(String(error)) : null };
}
