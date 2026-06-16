import { listPostersFromBackend } from "@/features/posters/api/posters.api";
import type { QRCode } from "@/features/posters/types";
import { useBackendQuery } from "@/shared/hooks/useBackendQuery";
import { useEventsStore } from "@/features/events";
import { useCallback } from "react";

/**
 * Fetches posters from the backend (GET /qr/). Use for dashboard and admin.
 */
export function useBackendPosters(refreshKey?: number): {
  posters: QRCode[];
  loading: boolean;
  error: Error | null;
} {
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const fetchFn = useCallback(() => listPostersFromBackend(schoolFilter ?? undefined), [schoolFilter]);
  const queryKey = `${schoolFilter || ""}-${refreshKey || ""}`;

  const { data: posters, loading, error } = useBackendQuery(
    fetchFn,
    [] as QRCode[],
    queryKey,
  );

  return { posters, loading, error };
}
