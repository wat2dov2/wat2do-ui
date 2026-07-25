import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EventList } from "@/features/events/components/EventList";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";
import { fetchOrganizationEvents } from "@/features/events/api/events.api";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { Event } from "@/shared/types";

interface OrganizationEventsGridProps {
  organizationName: string;
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
  organizationName,
  school,
}: OrganizationEventsGridProps) {
  const { data: events, isPending } = useQuery({
    queryKey: queryKeys.events.byOrganization(organizationName, school),
    queryFn: () => fetchOrganizationEvents(organizationName, school),
    enabled: Boolean(organizationName && school),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  const { data: eventStatsData, isSuccess: eventStatsReady } = useEventStats(school);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const organizationEvents = useMemo(() => events ?? [], [events]);
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
