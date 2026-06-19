import { useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRecommendations } from "@/features/recommendations";
import { useSearch } from "@/features/search";
import { useLatestAddedEvent } from "@/features/events/hooks/useLatestAddedEvent";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { toast } from "@/shared/hooks/use-toast";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { getUniqueEvents } from "@/shared/utils/event";

interface UseEventsPageDataOptions {
  profileCompleted: boolean;
}

/**
 * Hook that aggregates all data orchestration for the EventsPageContainer:
 * events store, saved events, promotions, recommendations, search/filters,
 * and derived ordered events.
 */
export function useEventsPageData({ profileCompleted }: UseEventsPageDataOptions) {
  const { t } = useTranslation();
  // Read from stores (single source of truth -- no duplicate fetches)
  const events = useEventsStore((s) => s.events);
  const promotedEvents = useEventsStore((s) => s.promotedEvents);
  const isLoading = useEventsStore((s) => s.isLoading);
  const error = useEventsStore((s) => s.error);
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const fetchEvents = useEventsStore((s) => s.fetchEvents);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const savedEventIds = useSavedEventsStore((s) => s.savedEventIds);

  const { latest: latestAddedEvent } = useLatestAddedEvent(schoolFilter ?? undefined);

  const { recommendations } = useRecommendations();

  const filters = useSearch({
    events,
    profileCompleted,
    savedEventIds,
  });

  // Single authoritative ordering pipeline:
  //   1. Within each group, recommended events sort by score (desc).
  //   2. Otherwise preserve the original filtered order.
  // Dedupe happens here so the list consumer does not need to repeat it.
  const orderedEvents = useMemo(() => {
    const deduped = getUniqueEvents(filters.filteredEvents);
    const scoreMap =
      recommendations.length === 0
        ? null
        : new Map(recommendations.map((r) => [r.event_id, r.score]));

    // Attach a numeric priority tuple to each event, then stable-sort by it.
    // (-score, originalIndex) — lower is earlier.
    const withRank = deduped.map((event, index) => {
      const score = scoreMap?.get(event.id) ?? -1;
      return { event, score, index };
    });

    withRank.sort((a, b) => {
      if (a.score >= 0 && b.score < 0) return -1;
      if (a.score < 0 && b.score >= 0) return 1;
      if (a.score >= 0 && b.score >= 0 && a.score !== b.score) return b.score - a.score;
      return a.index - b.index;
    });

    return withRank.map((x) => x.event);
  }, [filters.filteredEvents, recommendations]);

  const handleDeleteEvent = useCallback(
    async (eventId: number) => {
      try {
        await deleteEvent(eventId);
      } catch (err) {
        console.error("Failed to delete event:", err);
        const message = getApiErrorMessage(err, t("events.deleteFailed"));
        toast({
          title: "Delete Failed",
          description: message,
          variant: "destructive",
        });
      }
    },
    [deleteEvent, t]
  );

  return {
    isLoading,
    error,
    fetchEvents,
    savedEventIds,
    promotedEvents,
    latestAddedEvent,
    filters,
    orderedEvents,
    handleDeleteEvent,
  };
}
