import { useMemo, useCallback } from "react";
import { useRecommendations } from "@/features/recommendations";
import { useSearch } from "@/features/search";
import { useLatestAddedEvent } from "@/features/events/hooks/useLatestAddedEvent";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { usePromotionsStore } from "@/features/credits";
import { showToast } from "@/shared/ui/toast";
import { ApiError } from "@/shared/services/apiClient";
import { getUniqueEvents } from "@/shared/utils/event";
import { idArrayEqual } from "@/shared/hooks/useShallowIdArrayEquality";

interface UseEventsPageDataOptions {
  profileCompleted: boolean;
}

/**
 * Hook that aggregates all data orchestration for the EventsPageContainer:
 * events store, saved events, promotions, recommendations, search/filters,
 * and derived ordered events.
 */
export function useEventsPageData({ profileCompleted }: UseEventsPageDataOptions) {
  // Read from stores (single source of truth -- no duplicate fetches)
  const events = useEventsStore((s) => s.events);
  const isLoading = useEventsStore((s) => s.isLoading);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const savedEventIds = useSavedEventsStore((s) => s.savedEventIds);
  // Custom equality: the store re-sets this array on every reconcile, so
  // the reference changes even when the ID set is identical. Compare
  // element-wise to avoid waking EventList's sort memo.
  const activePromotedEventIds = usePromotionsStore(
    (s) => s.activePromotedEventIds,
    idArrayEqual,
  );

  const { latest: latestAddedEvent } = useLatestAddedEvent();

  const { recommendations, isLoading: recsLoading } = useRecommendations();

  const filters = useSearch({
    events,
    profileCompleted,
    savedEventIds,
  });

  // Single authoritative ordering pipeline:
  //   1. Promoted events float to the top.
  //   2. Within each group, recommended events sort by score (desc).
  //   3. Otherwise preserve the original filtered order.
  // Dedupe happens here so the list consumer does not need to repeat it.
  const orderedEvents = useMemo(() => {
    const deduped = getUniqueEvents(filters.filteredEvents);
    const promotedSet = new Set(activePromotedEventIds);
    const scoreMap =
      recommendations.length === 0
        ? null
        : new Map(recommendations.map((r) => [r.event_id, r.score]));

    // Attach a numeric priority tuple to each event, then stable-sort by it.
    // (promotedRank, -score, originalIndex) — lower is earlier.
    const withRank = deduped.map((event, index) => {
      const promotedRank = promotedSet.has(event.id) ? 0 : 1;
      const score = scoreMap?.get(event.id) ?? -1;
      return { event, promotedRank, score, index };
    });

    withRank.sort((a, b) => {
      if (a.promotedRank !== b.promotedRank) return a.promotedRank - b.promotedRank;
      if (a.score >= 0 && b.score < 0) return -1;
      if (a.score < 0 && b.score >= 0) return 1;
      if (a.score >= 0 && b.score >= 0 && a.score !== b.score) return b.score - a.score;
      return a.index - b.index;
    });

    return withRank.map((x) => x.event);
  }, [filters.filteredEvents, recommendations, activePromotedEventIds]);

  const handleDeleteEvent = useCallback(
    async (eventId: number) => {
      try {
        await deleteEvent(eventId);
      } catch (err) {
        console.error("Failed to delete event:", err);
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to delete event";
        showToast(message, "error");
      }
    },
    [deleteEvent]
  );

  return {
    isLoading,
    savedEventIds,
    latestAddedEvent,
    recsLoading,
    filters,
    orderedEvents,
    handleDeleteEvent,
  };
}
