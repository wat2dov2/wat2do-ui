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
import type { ApiGoingEventSelection } from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import { tracker } from "@/shared/services/trackingService";
import { ApiError, isApiError } from "@/shared/services/apiClient";
import type { Event } from "@/shared/types";
import {
  isActiveOrUpcomingOccurrence,
  isEventHappeningNow,
  occurrenceVisibleUntilMs,
  type Occurrence,
} from "@/shared/utils/date";

type EventStatsMap = Record<string, EventStats>;
const UNAVAILABLE_OCCURRENCE_ERROR = "One or more occurrences can no longer be selected";

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

/**
 * Notify me for one event (`user_going_events`). With `dates`, only those of
 * its dates are offered, and saving keeps the viewer's other dates as they
 * were: an event with tickets offers Notify me for its dates without them.
 */
export function useGoingEventSelection(
  event: Event,
  school: string | null | undefined,
  dates?: readonly string[],
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: selections = [] } = useGoingEvents();
  const now = useCurrentTime(event.occurrences);
  const allSelectedIds = useMemo(
    () =>
      selections.find((selection) => selection.event_id === event.id)
        ?.occurrence_ids ?? [],
    [event.id, selections],
  );
  const offered = useMemo(
    () => (event.occurrences ?? []).filter((occurrence) => !dates || dates.includes(occurrence.id)),
    [event.occurrences, dates],
  );
  const selectedIds = useMemo(
    () => allSelectedIds.filter((id) => offered.some((occurrence) => occurrence.id === id)),
    [allSelectedIds, offered],
  );
  const selectableOccurrences = useMemo(() => {
    if (event.cancelled || now === null || isEventHappeningNow(event, new Date(now))) return [];
    return [...offered]
      .filter((occurrence) => new Date(occurrence.dtstart_utc).getTime() > now)
      .sort(
        (left, right) =>
          new Date(left.dtstart_utc).getTime() -
          new Date(right.dtstart_utc).getTime(),
      );
  }, [event, now, offered]);
  const selectableIds = useMemo(
    () => new Set(selectableOccurrences.map((occurrence) => occurrence.id)),
    [selectableOccurrences],
  );
  const selectedSelectableIds = useMemo(
    () => selectedIds.filter((id) => selectableIds.has(id)),
    [selectableIds, selectedIds],
  );
  const isActive = useMemo(
    () => !event.cancelled && now !== null && offered.some(
      (occurrence) => selectedIds.includes(occurrence.id) && isActiveOrUpcomingOccurrence(occurrence, now),
    ),
    [event.cancelled, offered, now, selectedIds],
  );
  // Async sign-in and optimistic mutation work can outlive a rendered clock tick.
  const canRegisterNow = () => !event.cancelled && !isEventHappeningNow(event, new Date());

  const mutation = useMutation({
    mutationKey: queryKeys.goingEvents.all,
    mutationFn: async ({ eventId, occurrenceIds }: GoingMutationVariables) => {
      if (occurrenceIds.length === 0) return clearGoingEvent(eventId);
      if (!canRegisterNow()) throw new ApiError(400, { detail: UNAVAILABLE_OCCURRENCE_ERROR });
      return setGoingEventOccurrences(eventId, occurrenceIds);
    },
    onMutate: async ({ eventId, occurrenceIds, userId: mutationUserId }) => {
      const queryKey = queryKeys.goingEvents.byUser(mutationUserId ?? "");
      const cancellation = queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<ApiGoingEventSelection[]>(queryKey) ?? [];
      patchGoingSelection(queryClient, queryKey, {
        event_id: eventId,
        occurrence_ids: occurrenceIds,
      });
      await cancellation;
      return { previous, queryKey, eventId };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        patchGoingSelection(queryClient, context.queryKey, context.previous.find(selection => selection.event_id === context.eventId) ?? { event_id: context.eventId, occurrence_ids: [] });
      }
      toast({
        description: t(isApiError(error) && error.message === UNAVAILABLE_OCCURRENCE_ERROR
          ? "events.goingEvents.timeUnavailable"
          : "events.goingEvents.saveFailed"),
        variant: "destructive",
      });
    },
    onSuccess: (response, variables, context) => {
      patchGoingSelection(queryClient, context.queryKey, response);
      if (school) {
        queryClient.setQueryData<EventStatsMap>(
          queryKeys.events.stats(school),
          current => current ? ({
            ...current,
            [String(response.event_id)]: {
              click_count: current[String(response.event_id)]?.click_count ?? 0,
              going_count: response.going_count,
            },
          }) : current,
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
      queryClient.isMutating({ mutationKey: queryKeys.goingEvents.all }) === 1
        ? queryClient.invalidateQueries({ queryKey: queryKeys.goingEvents.byUser(variables.userId ?? "") })
        : Promise.resolve(),
  });

  return {
    selectedIds,
    selectedSelectableIds,
    selectableOccurrences,
    isActive,
    currentTimeMs: now,
    isTimeUnavailable: now !== null && selectableOccurrences.length === 0,
    canRegisterNow,
    isPending: mutation.isPending,
    saveSelection: (occurrenceIds: string[]) =>
      mutation.mutateAsync({
        eventId: event.id,
        // Dates this card does not offer (a ticket's, say) stay as they were.
        occurrenceIds: [
          ...allSelectedIds.filter((id) => !offered.some((occurrence) => occurrence.id === id)),
          ...occurrenceIds,
        ],
        userId: getUserId(),
      }),
  };
}

export function useCurrentTime(occurrences?: readonly Occurrence[]) {
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

  useEffect(() => {
    if (!occurrences || now === null) return;
    const nextBoundaryMs = Math.min(...occurrences
      .flatMap((occurrence) => {
        const visibleUntilMs = occurrenceVisibleUntilMs(occurrence);
        const startMs = new Date(occurrence.dtstart_utc).getTime();
        // Live events include their end instant, so reopen immediately afterward.
        return visibleUntilMs === null ? [startMs] : [startMs, visibleUntilMs + 1];
      })
      .filter((boundaryMs) => boundaryMs > now));
    const delayMs = nextBoundaryMs - Date.now();
    // Minute ticks handle distant dates; timers cannot exceed a signed 32-bit delay.
    if (!Number.isFinite(delayMs) || delayMs > 2_147_483_647) return;
    const boundary = window.setTimeout(() => setNow(Date.now()), Math.max(0, delayMs));
    return () => window.clearTimeout(boundary);
  }, [now, occurrences]);

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
