import { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSearch } from "@/features/search";
import { useEventsStore } from "@/features/events/store/events.store";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import {
  useCurrentTime,
  useGoingEvents,
} from "@/features/events/hooks/useGoingEvents";
import { useLastEventsVisit } from "@/features/events/hooks/useLastEventsVisit";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { getUniqueEvents } from "@/shared/utils/event";
import { hasActiveEventOccurrence } from "@/shared/utils/date";
import type { Event } from "@/shared/types";

interface UseEventsPageDataOptions {
  profileCompleted: boolean;
  userEmail: string | null;
}

function derivePromotedEvents(
  snapshotPromoted: Event[],
  allEvents: Event[],
  activePromotedIds: number[],
): Event[] {
  const byId = new Map<number, Event>();

  for (const event of snapshotPromoted) {
    byId.set(event.id, event);
  }

  for (const id of activePromotedIds) {
    if (byId.has(id)) continue;
    const event = allEvents.find((item) => item.id === id);
    if (event) {
      byId.set(id, event);
    }
  }

  return Array.from(byId.values());
}

/**
 * Hook that aggregates data orchestration for the EventsPageContainer:
 * embedded browse snapshot, going events, client-side counts overlay,
 * search/filters, and derived ordered events.
 */
export function useEventsPageData({
  profileCompleted,
  userEmail,
}: UseEventsPageDataOptions) {
  const router = useRouter();
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const lastVisitAt = useLastEventsVisit(userEmail, schoolFilter);
  const { data: goingSelections = [] } = useGoingEvents();
  const currentTimeMs = useCurrentTime();
  const goingEventIds = useMemo(
    () => goingSelections.map((selection) => selection.event_id),
    [goingSelections],
  );
  const { data: eventStatsData, isSuccess: eventStatsReady } = useEventStats(schoolFilter);
  const eventStats = eventStatsReady ? (eventStatsData ?? {}) : null;
  const activePromotedEventIds = useCreditsStore((s) => s.activePromotedEventIds);

  const events = useEventsStore((s) => s.events);
  const snapshotPromotedEvents = useEventsStore((s) => s.promotedEvents);
  const latestAddedEvent = useEventsStore((s) => s.latestAddedEvent);
  const isLoading = useEventsStore((s) => s.isLoading);
  const error = useEventsStore((s) => s.error);
  const visibleEvents = useMemo(
    () =>
      currentTimeMs === null
        ? events
        : events.filter((event) =>
            hasActiveEventOccurrence(event, currentTimeMs),
          ),
    [currentTimeMs, events],
  );
  const visibleSnapshotPromotedEvents = useMemo(
    () =>
      currentTimeMs === null
        ? snapshotPromotedEvents
        : snapshotPromotedEvents.filter((event) =>
            hasActiveEventOccurrence(event, currentTimeMs),
          ),
    [currentTimeMs, snapshotPromotedEvents],
  );

  const filters = useSearch({
    events: visibleEvents,
    profileCompleted,
    goingEventIds,
  });

  const orderedEvents = useMemo(
    () => getUniqueEvents(filters.filteredEvents),
    [filters.filteredEvents],
  );

  const promotedEvents = useMemo(
    () =>
      derivePromotedEvents(
        visibleSnapshotPromotedEvents,
        visibleEvents,
        activePromotedEventIds,
      ),
    [
      visibleSnapshotPromotedEvents,
      visibleEvents,
      activePromotedEventIds,
    ],
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
    goingEventIds,
    eventStats,
    schoolFilter,
    lastVisitAt,
    latestAddedEvent,
    promotedEvents,
    filters,
    orderedEvents,
    allEvents: visibleEvents,
  };
}
