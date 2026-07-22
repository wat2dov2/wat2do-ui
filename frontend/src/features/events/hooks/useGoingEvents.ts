import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId } from "@/features/auth/api/auth.api";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import {
  clearGoingEvent,
  fetchGoingEvents,
  setGoingEventOccurrences,
  type EventStats,
} from "@/features/events/api/events.api";
import type {
  ApiGoingEventSelection,
  ApiGoingEventStatusResponse,
} from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { productControl } from "@/shared/config/productControl";
import { queryKeys } from "@/shared/lib/queryKeys";
import { tracker } from "@/shared/services/trackingService";
import type { Event } from "@/shared/types";

type EventStatsMap = Record<string, EventStats>;

interface GoingMutationVariables {
  eventId: number;
  occurrenceIds: string[];
}

export function useGoingEvents() {
  const { isAuthenticated } = useAuthState();
  const userId = isAuthenticated ? getUserId() : undefined;

  return useQuery({
    queryKey: queryKeys.goingEvents.byUser(userId ?? ""),
    queryFn: fetchGoingEvents,
    enabled: Boolean(userId),
    staleTime: productControl.clientCache.liveEventDataStaleMs,
  });
}

export function useGoingEventSelection(
  event: Event,
  school: string | null | undefined,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthState();
  const userId = isAuthenticated ? getUserId() : undefined;
  const queryKey = queryKeys.goingEvents.byUser(userId ?? "");
  const { data: selections = [] } = useGoingEvents();
  const now = useCurrentTime();
  const selectedIds = useMemo(
    () =>
      selections.find((selection) => selection.event_id === event.id)
        ?.occurrence_ids ?? [],
    [event.id, selections],
  );
  const selectableOccurrences = useMemo(() => {
    if (event.cancelled || now === null) return [];
    return [...(event.occurrences ?? [])]
      .filter((occurrence) => new Date(occurrence.dtstart_utc).getTime() >= now)
      .sort(
        (left, right) =>
          new Date(left.dtstart_utc).getTime() -
          new Date(right.dtstart_utc).getTime(),
      );
  }, [event.cancelled, event.occurrences, now]);
  const selectableIds = useMemo(
    () => new Set(selectableOccurrences.map((occurrence) => occurrence.id)),
    [selectableOccurrences],
  );
  const selectedSelectableIds = useMemo(
    () => selectedIds.filter((id) => selectableIds.has(id)),
    [selectableIds, selectedIds],
  );

  const mutation = useMutation({
    mutationFn: ({ eventId, occurrenceIds }: GoingMutationVariables) =>
      occurrenceIds.length > 0
        ? setGoingEventOccurrences(eventId, occurrenceIds)
        : clearGoingEvent(eventId),
    onMutate: async ({ eventId, occurrenceIds }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<ApiGoingEventSelection[]>(queryKey) ?? [];
      queryClient.setQueryData<ApiGoingEventSelection[]>(queryKey, (current = []) => {
        const withoutEvent = current.filter(
          (selection) => selection.event_id !== eventId,
        );
        return occurrenceIds.length > 0
          ? [...withoutEvent, { event_id: eventId, occurrence_ids: occurrenceIds }]
          : withoutEvent;
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast({
        description: t("events.goingEvents.saveFailed"),
        variant: "destructive",
      });
    },
    onSuccess: (response, variables, context) => {
      patchAuthoritativeSelection(queryClient, queryKey, response);
      if (school) {
        queryClient.setQueryData<EventStatsMap>(
          queryKeys.events.stats(school),
          (current = {}) => ({
            ...current,
            [String(response.event_id)]: {
              click_count: current[String(response.event_id)]?.click_count ?? 0,
              going_count: response.going_count,
            },
          }),
        );
      }
      const wasGoing = Boolean(
        context?.previous.some(
          (selection) =>
            selection.event_id === variables.eventId &&
            selection.occurrence_ids.length > 0,
        ),
      );
      const isGoing = response.status === "going";
      if (wasGoing !== isGoing) {
        tracker.track(response.event_id, isGoing ? "going" : "ungoing");
      }
    },
  });

  return {
    selectedIds,
    selectedSelectableIds,
    selectableOccurrences,
    isActive: selectedSelectableIds.length > 0,
    isPending: mutation.isPending,
    saveSelection: (occurrenceIds: string[]) =>
      mutation.mutateAsync({ eventId: event.id, occurrenceIds }),
  };
}

export function useCurrentTime() {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => setNow(Date.now());
    const initial = window.setTimeout(sync, 0);
    const interval = window.setInterval(sync, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  return now;
}

function patchAuthoritativeSelection(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: ReturnType<typeof queryKeys.goingEvents.byUser>,
  response: ApiGoingEventStatusResponse,
) {
  queryClient.setQueryData<ApiGoingEventSelection[]>(queryKey, (current = []) => {
    const withoutEvent = current.filter(
      (selection) => selection.event_id !== response.event_id,
    );
    return response.occurrence_ids.length > 0
      ? [
          ...withoutEvent,
          {
            event_id: response.event_id,
            occurrence_ids: response.occurrence_ids,
          },
        ]
      : withoutEvent;
  });
}
