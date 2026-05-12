import { useBackendQuery } from "@/shared/hooks/useBackendQuery";
import { fetchLatestAddedEvent, type LatestAddedEvent } from "@/features/events/api/events.api";

/**
 * Fetches the most recently added event from the server for "X added 22 minutes ago" text.
 */
export function useLatestAddedEvent() {
  const { data, loading } = useBackendQuery<LatestAddedEvent | null>(
    fetchLatestAddedEvent,
    null,
  );
  return { latest: data, isLoading: loading };
}
