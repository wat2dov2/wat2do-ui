import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDiscoveryQueryTracking } from "@/shared/hooks/useDiscoveryQueryTracking";
import { storeStatesToFilterState } from "@/features/search/api/filterService";
import { useSearchStore } from "@/features/search/store/search.store";
import { useSearch } from "@/features/search/hooks/useSearch";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import {
  useCurrentTime,
  useGoingEvents,
} from "@/features/events/hooks/useGoingEvents";
import { resolveSchool } from "@/shared/constants/schools";
import { getUniqueEvents } from "@/shared/utils/event";
import { hasActiveEventOccurrence } from "@/shared/utils/date";
import i18n from "@/shared/lib/i18n";
import { eventFeedQueryOptions, type PaginatedEventsResponse } from "@/features/events/api/events.api";

interface UseEventsPageDataOptions {
  /** The server's browse snapshot, or null when that fetch failed. */
  initialSnapshot: PaginatedEventsResponse | null;
  initialSchool: string;
}

/**
 * Hook that aggregates data orchestration for the EventsPageContainer:
 * embedded browse snapshot, going events, client-side counts overlay,
 * search/filters, and derived ordered events.
 */
export function useEventsPageData({
  initialSnapshot,
  initialSchool,
}: UseEventsPageDataOptions) {
  const schoolFilter = resolveSchool(initialSchool);
  const query = useQuery({
    ...eventFeedQueryOptions(schoolFilter),
    initialData: initialSnapshot ?? undefined,
    initialDataUpdatedAt: initialSnapshot?.generated_at,
  });
  const events = useMemo(() => query.data?.items ?? [], [query.data]);
  const latestAddedEvent = query.data?.latest_added_event ?? null;
  const isLoading = query.isLoading;
  const error = query.isLoadingError ? i18n.t("events.loadFailed") : null;
  const { data: goingSelections = [] } = useGoingEvents();
  const currentTimeMs = useCurrentTime();
  const goingEventIds = useMemo(
    () => goingSelections.map((selection) => selection.event_id),
    [goingSelections],
  );
  const { data: eventStatsData, isSuccess: eventStatsReady } = useEventStats(schoolFilter);
  const eventStats = eventStatsReady ? (eventStatsData ?? {}) : null;

  const visibleEvents = useMemo(
    () =>
      currentTimeMs === null
        ? events
        : events.filter((event) =>
            hasActiveEventOccurrence(event, currentTimeMs),
          ),
    [currentTimeMs, events],
  );

  const filters = useSearch({
    events: visibleEvents,
    goingEventIds,
    goingCounts: eventStats,
  });

  const orderedEvents = useMemo(
    () => getUniqueEvents(filters.filteredEvents),
    [filters.filteredEvents],
  );

  const totalEvents = filters.filteredEvents.length;
  const queryRevision = useSearchStore((state) => state.queryRevision);
  const { searchQuery, ...appliedFilters } = storeStatesToFilterState(filters);
  useDiscoveryQueryTracking({
    school: schoolFilter,
    surface: "events",
    search_query: searchQuery,
    filters: appliedFilters,
  }, queryRevision);

  const refreshEvents = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    isLoading,
    error,
    refreshEvents,
    totalEvents,
    eventStats,
    latestAddedEvent,
    filters,
    orderedEvents,
    allEvents: visibleEvents,
  };
}
