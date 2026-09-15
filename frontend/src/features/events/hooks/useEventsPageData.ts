import { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSearch } from "@/features/search/hooks/useSearch";
import { useEventsStore } from "@/features/events/store/events.store";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import {
  useCurrentTime,
  useGoingEvents,
} from "@/features/events/hooks/useGoingEvents";
import { resolveSchool } from "@/shared/constants/schools";
import { getUniqueEvents } from "@/shared/utils/event";
import { hasActiveEventOccurrence } from "@/shared/utils/date";
import i18n from "@/shared/lib/i18n";
import type { LatestAddedEvent } from "@/features/events/api/events.api";
import type { SchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import type { Event } from "@/shared/types";

interface UseEventsPageDataOptions {
  /** The server's browse snapshot, or null when that fetch failed. */
  initialSnapshot: SchoolBrowseSnapshot | null;
  initialSchool: string;
}

interface EventFeedSource {
  events: Event[];
  latestAddedEvent: LatestAddedEvent;
  isLoading: boolean;
  error: string | null;
  schoolFilter: string;
}

/** Render the server snapshot until store hydration to avoid an empty-feed flash. */
function useEventFeedSource(
  initialSnapshot: SchoolBrowseSnapshot | null,
  initialSchool: string,
): EventFeedSource {
  const hasHydrated = useEventsStore((s) => s.hasHydratedInitialFeed);
  const storeEvents = useEventsStore((s) => s.events);
  const storeLatestAddedEvent = useEventsStore((s) => s.latestAddedEvent);
  const storeIsLoading = useEventsStore((s) => s.isLoading);
  const storeError = useEventsStore((s) => s.error);
  const storeSchoolFilter = useEventsStore((s) => s.schoolFilter);

  return useMemo(() => {
    if (hasHydrated) {
      return {
        events: storeEvents,
        latestAddedEvent: storeLatestAddedEvent,
        isLoading: storeIsLoading,
        error: storeError,
        schoolFilter: resolveSchool(storeSchoolFilter),
      };
    }

    return {
      events: initialSnapshot?.feed.items ?? [],
      latestAddedEvent: initialSnapshot?.feed.latest_added_event ?? null,
      // The snapshot is the data, so nothing is pending; a missing snapshot
      // means the server's fetch failed and there is nothing more coming.
      isLoading: false,
      error: initialSnapshot ? null : i18n.t("events.loadFailed"),
      schoolFilter: resolveSchool(initialSchool),
    };
  }, [
    hasHydrated,
    initialSchool,
    initialSnapshot,
    storeError,
    storeEvents,
    storeIsLoading,
    storeLatestAddedEvent,
    storeSchoolFilter,
  ]);
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
  const router = useRouter();
  const {
    events,
    latestAddedEvent,
    isLoading,
    error,
    schoolFilter,
  } = useEventFeedSource(initialSnapshot, initialSchool);
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

  const refreshEvents = useCallback(() => {
    router.refresh();
  }, [router]);

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
