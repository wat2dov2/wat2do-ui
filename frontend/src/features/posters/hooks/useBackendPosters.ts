import { listPostersFromBackend } from "@/features/posters/api/posters.api";
import type { QRCode } from "@/features/posters/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";

/**
 * Fetches posters from the backend (GET /qr/). Use for dashboard and admin.
 */
export function useBackendPosters(school: string | null) {
  const { data: posters = [], isLoading } = useQuery({
    queryKey: queryKeys.posters.list(school),
    queryFn: () => listPostersFromBackend(school ?? undefined),
    placeholderData: [] as QRCode[],
  });

  return { posters, loading: isLoading };
}
