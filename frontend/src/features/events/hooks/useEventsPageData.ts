import { useMemo, useCallback, useState, useEffect } from "react";
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

  // Trigger event fetch on mount of the events page (single fetch view architecture)
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Keep a stable ref/state for the recommendations score map that we use for sorting.
  // This prevents events from shifting order after they've loaded on the screen.
  const filterKey = JSON.stringify({
    searchQuery: filters.searchQuery,
    selectedCategories: filters.selectedCategories,
    selectedLocations: filters.selectedLocations,
    selectedFoods: filters.selectedFoods,
    selectedDays: filters.selectedDays,
    priceRange: filters.priceRange,
    registration: filters.registration,
    selectedOrganizations: filters.selectedOrganizations,
    freeFoodFilter: filters.freeFoodFilter,
    savedFilter: filters.savedFilter,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  });

  // Track if events have been rendered to the user.
  // If they have, we lock the recommendations sorting until the next filter interaction
  // to prevent layout shifting/stuttering while browsing.
  const [hasRenderedEvents, setHasRenderedEvents] = useState(false);

  useEffect(() => {
    if (events.length > 0 && !isLoading) {
      Promise.resolve().then(() => {
        setHasRenderedEvents(true);
      });
    }
  }, [events, isLoading]);

  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  const [activeScoreMap, setActiveScoreMap] = useState<Map<number, number> | null>(() => {
    if (recommendations.length > 0) {
      return new Map(recommendations.map((r) => [r.event_id, r.score]));
    }
    return null;
  });

  // Synchronous derived state adjustment during render (prevents flash on filter change)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setHasRenderedEvents(false);
    setActiveScoreMap(
      recommendations.length > 0
        ? new Map(recommendations.map((r) => [r.event_id, r.score]))
        : null
    );
  }

  // Update score map if recommendations load in background BEFORE events have loaded/rendered.
  // If events have already rendered, ignore background updates to keep visual state stable.
  useEffect(() => {
    if (recommendations.length > 0 && !hasRenderedEvents) {
      const map = new Map(recommendations.map((r) => [r.event_id, r.score]));
      Promise.resolve().then(() => {
        setActiveScoreMap(map);
      });
    }
  }, [recommendations, hasRenderedEvents]);

  // Single authoritative ordering pipeline:
  //   1. Within each group, recommended events sort by score (desc).
  //   2. Otherwise preserve the original filtered order.
  // Dedupe happens here so the list consumer does not need to repeat it.
  const orderedEvents = useMemo(() => {
    const deduped = getUniqueEvents(filters.filteredEvents);
    const scoreMap = activeScoreMap;

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
  }, [filters.filteredEvents, activeScoreMap]);

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
