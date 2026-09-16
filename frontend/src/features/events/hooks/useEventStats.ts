import { useEffect, useRef } from "react";
import { tracker } from "@/shared/services/trackingService";
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

export function useEventView(eventId: number, school: string) {
  const queryClient = useQueryClient();
  const lastViewedId = useRef<number | null>(null);

  useEffect(() => {
    if (lastViewedId.current === eventId) return;
    lastViewedId.current = eventId;
    tracker.track(eventId, "click");
    tracker.track(eventId, "detail_view");
    queryClient.setQueryData<EventStatsMap>(queryKeys.events.stats(school), (previous) => {
      const current = previous?.[String(eventId)] ?? EMPTY_EVENT_STATS;
      return {
        ...previous,
        [String(eventId)]: { ...current, click_count: current.click_count + 1 },
      };
    });
  }, [eventId, queryClient, school]);
}
