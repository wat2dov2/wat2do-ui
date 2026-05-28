import {
  getScansFromBackend,
  normalizeBackendScan,
} from "@/features/posters/api/scans.api";
import type { QRCodeScan } from "@/features/posters/types";
import { useBackendQuery } from "@/shared/hooks/useBackendQuery";

/**
 * Fetches scans from the backend so that scans from any device (e.g. phone)
 * appear in the dashboard. Returns normalized QRCodeScan[] and loading state.
 */
export function useBackendScans(refreshKey?: number): {
  scans: QRCodeScan[];
  loading: boolean;
  error: Error | null;
} {
  const { data: scans, loading, error } = useBackendQuery(
    () => getScansFromBackend().then((raw) => raw.map(normalizeBackendScan)),
    [] as QRCodeScan[],
    refreshKey,
  );

  return { scans, loading, error };
}
