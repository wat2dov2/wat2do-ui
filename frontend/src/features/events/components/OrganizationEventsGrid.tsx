import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EventList } from "@/features/events/components/EventList";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";
import { fetchOrganizationEvents } from "@/features/events/api/events.api";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import { useCurrentTime } from "@/features/events/hooks/useGoingEvents";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import { hasActiveEventOccurrence } from "@/shared/utils/date";
import type { Event } from "@/shared/types";

interface OrganizationEventsGridProps {
  organizationId: number;
  school: string;
}

/**
 * Upcoming events for one organization, as a flat grid.
 *
 * The organization page shows the host's whole upcoming lineup, so there are no
 * filters and no date-section headings - just the feed order the backend
 * returns (soonest first).
 */
export function OrganizationEventsGrid({
  organizationId,
  school,
}: OrganizationEventsGridProps) {
  const { data: events, isPending } = useQuery({
    queryKey: queryKeys.events.byOrganization(organizationId, school),
    queryFn: () => fetchOrganizationEvents(organizationId, school),
    enabled: organizationId > 0 && Boolean(school),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  const { data: eventStatsData, isSuccess: eventStatsReady } = useEventStats(school);
  const currentTimeMs = useCurrentTime();
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const organizationEvents = useMemo(
    () =>
      currentTimeMs === null
        ? (events ?? [])
        : (events ?? []).filter((event) =>
            hasActiveEventOccurrence(event, currentTimeMs),
          ),
    [currentTimeMs, events],
  );
  const selectedEvent = useMemo(
    () => organizationEvents.find((event) => event.id === selectedEventId) ?? null,
    [organizationEvents, selectedEventId],
  );

  const handleEventClick = useCallback((event: Event) => {
    setSelectedEventId(event.id);
  }, []);

  const handleCloseEventDetails = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  return (
    <>
      <EventList
        events={organizationEvents}
        viewMode="grid"
        onEventClick={handleEventClick}
        eventStats={eventStatsReady ? (eventStatsData ?? {}) : null}
        isLoading={isPending}
        groupByDateSections={false}
      />
      <EventDetailsModal
        eventId={selectedEventId}
        event={selectedEvent}
        onClose={handleCloseEventDetails}
        allEvents={organizationEvents}
      />
    </>
  );
}
