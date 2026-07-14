import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchGoingCountsFromBackend } from "@/features/events/api/events.api";
import { useGoingEventsStore } from "@/features/events/store/goingEvents.store";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useGoingCounts(school: string | null | undefined) {
  const resolvedSchool = school ?? "";

  return useQuery({
    queryKey: queryKeys.going.counts(resolvedSchool),
    queryFn: () => fetchGoingCountsFromBackend(resolvedSchool),
    enabled: Boolean(resolvedSchool),
    staleTime: 60_000,
  });
}

function patchGoingCountEntry(
  queryClient: ReturnType<typeof useQueryClient>,
  school: string,
  eventId: number,
  updater: (current: number) => number,
) {
  const key = queryKeys.going.counts(school);
  queryClient.setQueryData<Record<string, number>>(key, (prev) => {
    // Seed the cache if the first fetch has not landed yet so toggles still
    // feel instant; the eventual fetch / response overwrites with server truth.
    const current = prev?.[String(eventId)] ?? 0;
    const next = Math.max(0, updater(current));
    return {
      ...(prev ?? {}),
      [String(eventId)]: next,
    };
  });
}

export function useGoingCountActions(school: string | null | undefined) {
  const queryClient = useQueryClient();
  const toggleGoingEvent = useGoingEventsStore((s) => s.toggleGoingEvent);
  const resolvedSchool = school ?? "";

  const toggleWithCounts = useCallback(
    async (eventId: number) => {
      const wasGoing = useGoingEventsStore.getState().goingEventIds.includes(eventId);

      if (resolvedSchool) {
        patchGoingCountEntry(queryClient, resolvedSchool, eventId, (current) =>
          wasGoing ? current - 1 : current + 1,
        );
      }

      try {
        const response = await toggleGoingEvent(eventId);
        if (response && resolvedSchool) {
          queryClient.setQueryData<Record<string, number>>(
            queryKeys.going.counts(resolvedSchool),
            (prev) => ({
              ...(prev ?? {}),
              [String(eventId)]: response.going_count,
            }),
          );
        }
        return response;
      } catch (error) {
        if (resolvedSchool) {
          patchGoingCountEntry(queryClient, resolvedSchool, eventId, (current) =>
            wasGoing ? current + 1 : current - 1,
          );
        }
        throw error;
      }
    },
    [queryClient, resolvedSchool, toggleGoingEvent],
  );

  return { toggleWithCounts };
}
