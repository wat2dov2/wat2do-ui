import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useDiscoveryQueryTracking } from "@/shared/hooks/useDiscoveryQueryTracking";
import { storeStatesToFilterState, useSearchStore, useSearch } from "@/features/search";
import { preferInterestsWithinDay } from "@/features/search/api/searchService";
import { useUserInterests } from "@/features/auth";
import {
  EMPTY_FILTER_STATE,
  feedFilterAvailability,
  isSameFilterState,
  resolveStartFromMs,
} from "@/features/search/api/filterService";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import {
  useCurrentTime,
  useGoingEvents,
} from "@/features/events/hooks/useGoingEvents";
import { controlBox } from "@/shared/config/controlBox";
import { START_FROM_NOW } from "@/shared/constants/eventFilters";
import { resolveSchool } from "@/shared/constants/schools";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { Event } from "@/shared/types";
import { getUniqueEvents } from "@/shared/utils/event";
import { hasActiveEventOccurrence } from "@/shared/utils/date";
import i18n from "@/shared/lib/i18n";
import {
  eventFeedQueryOptions,
  pastEventsQueryOptions,
  latestVisibleAddedEvent,
} from "@/features/events/api/events.api";
import type { EventFeedFirstScreen } from "@/features/events/lib/eventFeedFirstScreen";
import { buildEventHighlights } from "@/features/events/lib/eventHighlights";

const NO_EVENTS: Event[] = [];

interface UseEventsPageDataOptions {
  /** The server's first screen of the feed, or null when it could not read the feed. */
  firstScreen: EventFeedFirstScreen | null;
  initialSchool: string;
}

/** What the page lists for the reader's query. */
export interface EventListing {
  /** The events to show, in order. */
  events: Event[];
  /** How many events the list holds: the page's count. */
  total: number;
  /**
   * False while `events` is only the server's first screen of the default list;
   * the map, the calendar and More events wait for the rest.
   */
  complete: boolean;
}

/**
 * Hook that aggregates data orchestration for the EventsPageContainer:
 * the school's feed, going events, client-side counts overlay,
 * search/filters, and derived ordered events.
 */
export function useEventsPageData({
  firstScreen: serverFirstScreen,
  initialSchool,
}: UseEventsPageDataOptions) {
  const schoolFilter = resolveSchool(initialSchool);
  // The complete feed comes from the edge right after the page paints. Until it
  // arrives, the server's first screen stands in for the start of the default list,
  // so a failed read is retried quietly (React Query's backoff) before the page says so.
  const query = useQuery({
    ...eventFeedQueryOptions(schoolFilter),
    retry: controlBox.clientCache.eventFeedRetries,
  });
  const feed = query.data;
  const firstScreen = feed ? null : serverFirstScreen;
  const events = feed?.items ?? firstScreen?.events ?? NO_EVENTS;
  const isLoading = query.isLoading && firstScreen === null;
  // With nothing to show, a failed read is the page's error. Behind the first screen
  // it only stops what waits for the rest, which then offers to try again.
  const error = query.isLoadingError && firstScreen === null ? i18n.t("events.loadFailed") : null;
  const restLoadFailed = query.isLoadingError && firstScreen !== null;
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
  // The start filter decides what is listed. A start before now reaches events the
  // snapshot does not hold, so those are read from the API, narrowed by the query.
  const { getSchoolTimezone } = useSchoolDirectory();
  const startFrom = useSearchStore((state) => state.startFrom);
  const storedQuery = useSearchStore(useShallow(storeStatesToFilterState));
  const startMs = resolveStartFromMs(startFrom, listTimeMs, getSchoolTimezone(schoolFilter));
  const readsPast = startFrom !== START_FROM_NOW && (startMs === null || listTimeMs === null || startMs < listTimeMs);
  const pastQuery = useQuery({
    ...pastEventsQueryOptions(schoolFilter, storedQuery, readsPast && startMs !== null ? new Date(startMs).toISOString() : null),
    enabled: readsPast,
  });
  const pastEvents = readsPast ? pastQuery.data : undefined;
  const listedEvents = useMemo(
    () => pastEvents ? getUniqueEvents([...events, ...pastEvents]) : events,
    [events, pastEvents],
  );
  // The snapshot's events still on at the list's time, whatever the start filter
  // reaches: the "new" line, the highlights and their map only ever show these.
  const upcomingEvents = useMemo(
    () => listTimeMs === null ? events : events.filter((event) => hasActiveEventOccurrence(event, listTimeMs)),
    [events, listTimeMs],
  );
  const latestAddedEvent = useMemo(
    () => feed
      ? latestVisibleAddedEvent(feed.latest_added_event, events, upcomingEvents)
      : firstScreen?.latestAddedEvent ?? null,
    [events, feed, firstScreen, upcomingEvents],
  );
  // Cut from the complete feed once it arrives, at the list's own time, so the
  // highlights change only when the list does; until then, the server's cut.
  const highlightsTimeMs = listTimeMs ?? feed?.generated_at ?? serverFirstScreen?.listedAtMs ?? null;
  const highlights = useMemo(
    () => feed
      ? highlightsTimeMs === null ? null : buildEventHighlights(upcomingEvents, highlightsTimeMs)
      : firstScreen?.highlights ?? null,
    [feed, firstScreen, highlightsTimeMs, upcomingEvents],
  );
  const filterAvailability = useMemo(
    () => feed ? feedFilterAvailability(feed.items, schoolFilter) : firstScreen?.filterAvailability ?? null,
    [feed, firstScreen, schoolFilter],
  );

  const filters = useSearch({
    events: listedEvents,
    availability: filterAvailability,
    goingEventIds,
    goingCounts: eventStats,
    school: schoolFilter,
    // Until the browser clock starts, the time the data was cut decides which
    // calendar chips show, so the server's filter row already has them.
    currentTimeMs: listTimeMs ?? (feed ? feed.generated_at : firstScreen?.listedAtMs) ?? null,
  });

  // In date order with no category picked, the reader's interests lead each day.
  // They are empty in the server's HTML and until hydration, so the first screen matches.
  const interests = useUserInterests();
  const { sortBy, selectedCategories } = filters;
  const orderedEvents = useMemo(
    () => {
      const unique = getUniqueEvents(filters.filteredEvents);
      return sortBy === "date" && selectedCategories.length === 0 && listTimeMs !== null
        ? preferInterestsWithinDay(unique, interests, getSchoolTimezone, listTimeMs)
        : unique;
    },
    [filters.filteredEvents, sortBy, selectedCategories, interests, getSchoolTimezone, listTimeMs],
  );

  const appliedFilterState = storeStatesToFilterState(filters);
  const { searchQuery, ...appliedFilters } = appliedFilterState;
  useDiscoveryQueryTracking({
    school: schoolFilter,
    surface: "events",
    search_query: searchQuery,
    filters: appliedFilters,
  }, queryRevision);

  // The first screen holds only the start of the default list, so any other
  // query waits for the complete feed rather than show a partial answer, and a
  // start before now waits for the past events it reaches too.
  const listing: EventListing | null = feed && (!readsPast || pastEvents)
    ? { events: orderedEvents, total: filters.filteredEvents.length, complete: true }
    : firstScreen && isSameFilterState(appliedFilterState, EMPTY_FILTER_STATE)
      ? { events: orderedEvents, total: firstScreen.total, complete: false }
      : null;
  const pastLoadFailed = readsPast && pastQuery.isLoadingError;

  const refreshEvents = useCallback(() => {
    void query.refetch();
    if (pastQuery.isError) void pastQuery.refetch();
  }, [query, pastQuery]);

  return {
    appliedQueryKey: `${queryRevision}:${JSON.stringify({ searchQuery, ...appliedFilters })}`,
    currentTimeMs,
    isLoading,
    error,
    /** The rest of the feed, or the past events asked for, failed to load; what is shown stays usable. */
    restLoadFailed: restLoadFailed || pastLoadFailed,
    /** The feed is being read again (Try again). */
    isRefreshing: query.isFetching || pastQuery.isFetching,
    refreshEvents,
    eventStats,
    goingEventsReady,
    latestAddedEvent,
    filters,
    /** Null while the reader's results wait for the complete feed. */
    listing,
    /** The featured and carousel rows; null while the feed loads with no first screen. */
    highlights,
    /** Every event the page holds, past events the start filter reached included. */
    allEvents: listedEvents,
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
