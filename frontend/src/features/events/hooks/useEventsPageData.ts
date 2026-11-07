import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { discoverySnapshotSeed } from "@/shared/api/discovery.api";
import { useDiscoveryQueryTracking } from "@/shared/hooks/useDiscoveryQueryTracking";
import { storeStatesToFilterState, useSearchStore, useSearch } from "@/features/search";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import {
  useCurrentTime,
  useGoingEvents,
} from "@/features/events/hooks/useGoingEvents";
import { resolveSchool } from "@/shared/constants/schools";
import { getUniqueEvents } from "@/shared/utils/event";
import { hasActiveEventOccurrence } from "@/shared/utils/date";
import i18n from "@/shared/lib/i18n";
import {
  eventFeedQueryOptions,
  latestVisibleAddedEvent,
  type PaginatedEventsResponse,
} from "@/features/events/api/events.api";

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
    ...discoverySnapshotSeed(initialSnapshot),
  });
  const events = useMemo(() => query.data?.items ?? [], [query.data]);
  const isLoading = query.isLoading;
  const error = query.isLoadingError ? i18n.t("events.loadFailed") : null;
  const { data: goingSelections = [], isSuccess: goingEventsReady } = useGoingEvents();
  const currentTimeMs = useCurrentTime();
  const goingEventIds = useMemo(
    () => goingSelections.map((selection) => selection.event_id),
    [goingSelections],
  );
  const { data: eventStatsData, isSuccess: eventStatsReady } = useEventStats(schoolFilter);
  const eventStats = eventStatsReady ? (eventStatsData ?? {}) : null;

  const queryRevision = useSearchStore((state) => state.queryRevision);
  // Which events are still on (and which calendar chips apply) is decided at this
  // time, not every minute: an event ending while the reader scrolls would pull the
  // whole grid up under them. It moves on with the reader's next query or visit.
  const listTimeMs = useListTime(currentTimeMs, queryRevision);
  const visibleEvents = useMemo(
    () =>
      listTimeMs === null
        ? events
        : events.filter((event) =>
            hasActiveEventOccurrence(event, listTimeMs),
          ),
    [listTimeMs, events],
  );
  const latestAddedEvent = useMemo(
    () => latestVisibleAddedEvent(query.data?.latest_added_event ?? null, events, visibleEvents),
    [events, query.data, visibleEvents],
  );

  const filters = useSearch({
    events: visibleEvents,
    eventsReady: query.data !== undefined,
    goingEventIds,
    goingCounts: eventStats,
    school: schoolFilter,
    // Until the browser clock starts, the snapshot's own time decides which
    // calendar chips show, so the server's filter row already has them.
    currentTimeMs: listTimeMs ?? query.data?.generated_at ?? null,
  });

  const orderedEvents = useMemo(
    () => getUniqueEvents(filters.filteredEvents),
    [filters.filteredEvents],
  );

  const totalEvents = filters.filteredEvents.length;
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
    appliedQueryKey: `${queryRevision}:${JSON.stringify({ searchQuery, ...appliedFilters })}`,
    currentTimeMs,
    isLoading,
    error,
    refreshEvents,
    totalEvents,
    eventStats,
    goingEventsReady,
    latestAddedEvent,
    filters,
    orderedEvents,
    allEvents: visibleEvents,
  };
}

/**
 * The time the list is drawn at: the browser clock's first reading, then a fresh
 * reading whenever the reader changes their query (`revision`) or comes back to the
 * tab. Between those it holds still, so the list never reshapes on its own.
 */
function useListTime(nowMs: number | null, revision: number): number | null {
  const [list, setList] = useState<{ revision: number; timeMs: number | null }>({ revision, timeMs: nowMs });
  if (nowMs !== null && (list.timeMs === null || list.revision !== revision)) {
    setList({ revision, timeMs: nowMs });
  }
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        setList((current) => ({ ...current, timeMs: Date.now() }));
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  return list.timeMs;
}
