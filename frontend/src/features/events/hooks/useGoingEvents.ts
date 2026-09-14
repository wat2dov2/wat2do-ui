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
  ApiEventAttendeesResponse,
  ApiGoingEventSelection,
} from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import { tracker } from "@/shared/services/trackingService";
import { isApiError } from "@/shared/services/apiClient";
import type { Event } from "@/shared/types";
import { isActiveOrUpcomingOccurrence } from "@/shared/utils/date";

type EventStatsMap = Record<string, EventStats>;

interface GoingMutationVariables {
  eventId: number;
  occurrenceIds: string[];
  userId: string | undefined;
}

export function useGoingEvents() {
  const { isAuthenticated } = useAuthState();
  const userId = isAuthenticated ? getUserId() : undefined;

  return useQuery({
    queryKey: queryKeys.goingEvents.byUser(userId ?? ""),
    queryFn: fetchGoingEvents,
    enabled: Boolean(userId),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
}

export function useGoingEventSelection(
  event: Event,
  school: string | null | undefined,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
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
      .filter((occurrence) => isActiveOrUpcomingOccurrence(occurrence, now))
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
    onMutate: async ({ eventId, occurrenceIds, userId: mutationUserId }) => {
      const queryKey = queryKeys.goingEvents.byUser(mutationUserId ?? "");
      const attendeesKey = queryKeys.events.attendees(eventId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        queryClient.cancelQueries({ queryKey: attendeesKey }),
      ]);
      const previous =
        queryClient.getQueryData<ApiGoingEventSelection[]>(queryKey) ?? [];
      const previousAttendees = queryClient.getQueryData<ApiEventAttendeesResponse>(attendeesKey);
      const wasGoing = previous.some(selection => selection.event_id === eventId && selection.occurrence_ids.length > 0);
      const delta = Number(occurrenceIds.length > 0) - Number(wasGoing);
      const cachedStats = school
        ? queryClient.getQueryData<EventStatsMap>(queryKeys.events.stats(school))
        : undefined;
      queryClient.setQueryData<ApiEventAttendeesResponse>(attendeesKey, (current) => ({
        going_count: Math.max(0, (current?.going_count ?? cachedStats?.[String(eventId)]?.going_count ?? 0) + delta),
        attendees: current?.attendees ?? [],
      }));
      patchGoingSelection(queryClient, queryKey, {
        event_id: eventId,
        occurrence_ids: occurrenceIds,
      });
      return { previous, queryKey, previousAttendees, attendeesKey };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
        if (context.previousAttendees) {
          queryClient.setQueryData(context.attendeesKey, context.previousAttendees);
        } else {
          queryClient.resetQueries({ queryKey: context.attendeesKey, exact: true });
        }
      }
      toast({
        description: t(isApiError(error) && error.message === "One or more occurrences can no longer be selected"
          ? "events.goingEvents.timeUnavailable"
          : "events.goingEvents.saveFailed"),
        variant: "destructive",
      });
    },
    onSuccess: (response, variables, context) => {
      patchGoingSelection(queryClient, context.queryKey, response);
      queryClient.setQueryData<ApiEventAttendeesResponse>(context.attendeesKey, current => ({
        going_count: response.going_count,
        attendees: current?.attendees ?? [],
      }));
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
    onSettled: (_response, _error, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.events.attendees(variables.eventId) }),
  });

  return {
    selectedIds,
    selectedSelectableIds,
    selectableOccurrences,
    isActive: selectedSelectableIds.length > 0,
    isPending: mutation.isPending,
    saveSelection: (occurrenceIds: string[]) =>
      mutation.mutateAsync({
        eventId: event.id,
        occurrenceIds,
        userId: getUserId(),
      }),
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

function patchGoingSelection(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: ReturnType<typeof queryKeys.goingEvents.byUser>,
  response: ApiGoingEventSelection,
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
