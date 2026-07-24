import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchEventStatsFromBackend,
  type EventStats,
} from "@/features/events/api/events.api";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";

type EventStatsMap = Record<string, EventStats>;

const EMPTY_EVENT_STATS: EventStats = {
  click_count: 0,
  going_count: 0,
};

export function useEventStats(school: string | null | undefined) {
  const resolvedSchool = school ?? "";

  return useQuery({
    queryKey: queryKeys.events.stats(resolvedSchool),
    queryFn: () => fetchEventStatsFromBackend(resolvedSchool),
    enabled: Boolean(resolvedSchool),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
}

function patchEventStats(
  queryClient: ReturnType<typeof useQueryClient>,
  school: string,
  eventId: number,
  updater: (current: EventStats) => EventStats,
) {
  queryClient.setQueryData<EventStatsMap>(queryKeys.events.stats(school), (previous) => ({
    ...(previous ?? {}),
    [String(eventId)]: updater(previous?.[String(eventId)] ?? EMPTY_EVENT_STATS),
  }));
}

export function useEventStatsActions(school: string | null | undefined) {
  const queryClient = useQueryClient();
  const resolvedSchool = school ?? "";

  const incrementClickCount = useCallback(
    (eventId: number) => {
      if (!resolvedSchool) return;
      patchEventStats(queryClient, resolvedSchool, eventId, (current) => ({
        ...current,
        click_count: current.click_count + 1,
      }));
    },
    [queryClient, resolvedSchool],
  );

  return { incrementClickCount };
}
