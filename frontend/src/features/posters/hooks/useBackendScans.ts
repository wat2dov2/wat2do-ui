import {
  getScansFromBackend,
  normalizeBackendScan,
} from "@/features/posters/api/scans.api";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";

/**
 * Fetches scans from the backend so that scans from any device (e.g. phone)
 * appear in the dashboard. Returns normalized QRCodeScan[] and loading state.
 */
export function useBackendScans({ posterId, enabled = true }: { posterId?: string; enabled?: boolean } = {}) {
  const { data: scans = [], isLoading, isError, refetch } = useQuery({
    queryKey: posterId ? queryKeys.scans.byPoster(posterId) : queryKeys.scans.list(),
    queryFn: () => getScansFromBackend(posterId).then((raw) => raw.map(normalizeBackendScan)),
    enabled,
  });

  return { scans, loading: isLoading, isError, refetch };
}
