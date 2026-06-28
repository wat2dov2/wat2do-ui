import { listPostersFromBackend } from "@/features/posters/api/posters.api";
import type { QRCode } from "@/features/posters/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";
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

  const { data: posters = [], isLoading, error } = useQuery({
    queryKey: queryKeys.posters.list(schoolFilter, refreshKey),
    queryFn: fetchFn,
    placeholderData: [] as QRCode[],
  });

  return { posters, loading: isLoading, error: error instanceof Error ? error : error ? new Error(String(error)) : null };
}
