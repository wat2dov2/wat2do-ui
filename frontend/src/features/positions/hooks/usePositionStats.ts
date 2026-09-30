import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tracker } from "@/shared/services/trackingService";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import { fetchPositionStats } from "@/features/positions/api/positions.api";
import type { ApiPositionStatsResponse } from "@/shared/generated";

export function usePositionStats(school: string) {
  return useQuery({
    queryKey: queryKeys.positions.stats(school),
    queryFn: () => fetchPositionStats(school),
    enabled: Boolean(school),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
}

export function usePositionView(positionId: number | null, school: string) {
  const queryClient = useQueryClient();
  const lastViewedId = useRef<number | null>(null);
  useEffect(() => {
    if (lastViewedId.current === positionId) return;
    lastViewedId.current = positionId;
    if (positionId === null) return;
    tracker.trackPosition(positionId);
    queryClient.setQueryData<Record<string, ApiPositionStatsResponse>>(queryKeys.positions.stats(school), current => current ? ({
      ...current,
      [String(positionId)]: { click_count: (current[String(positionId)]?.click_count ?? 0) + 1 },
    }) : current);
  }, [positionId, queryClient, school]);
}
