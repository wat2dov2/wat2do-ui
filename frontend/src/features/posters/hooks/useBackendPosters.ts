import { listPostersFromBackend } from "@/features/posters/api/posters.api";
import type { QRCode } from "@/features/posters/types";
import { useBackendQuery } from "@/shared/hooks/useBackendQuery";

/**
 * Fetches posters from the backend (GET /qr/). Use for dashboard and admin.
 */
export function useBackendPosters(refreshKey?: number): {
  posters: QRCode[];
  loading: boolean;
  error: Error | null;
} {
  const { data: posters, loading, error } = useBackendQuery(
    listPostersFromBackend,
    [] as QRCode[],
    refreshKey,
  );

  return { posters, loading, error };
}
