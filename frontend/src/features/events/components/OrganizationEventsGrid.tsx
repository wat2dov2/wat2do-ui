import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EventList } from "@/features/events/components/EventList";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";
import { fetchOrganizationEvents } from "@/features/events/api/events.api";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import { useCurrentTime } from "@/features/events/hooks/useGoingEvents";
import { orderOrganizationEvents } from "@/features/events/lib/organizationEventOrder";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { Event } from "@/shared/types";

interface OrganizationEventsGridProps {
  organizationId: number;
  school: string;
  initialEvents: Event[];
}

/**
 * Every event one organization has run, past included, as a flat grid.
 *
 * The organization page is the host's whole record, so there are no filters and
 * no date-section headings. The backend returns one flat date-ascending list,
 * which would open the page on the host's oldest event; ordering here puts what
 * is still to come first (soonest first), then history (most recent first).
 */
export function OrganizationEventsGrid({
  organizationId,
  school,
  initialEvents,
}: OrganizationEventsGridProps) {
  const { data: events, isPending } = useQuery({
    queryKey: queryKeys.events.byOrganization(organizationId, school),
    queryFn: () => fetchOrganizationEvents(organizationId, school),
    enabled: organizationId > 0 && Boolean(school),
    initialData: initialEvents,
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  const { data: eventStatsData, isSuccess: eventStatsReady } = useEventStats(school);
  const currentTimeMs = useCurrentTime();
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  // `initialEvents` arrives from the server already in this order, so the
  // no-clock case is a pass-through rather than a different order the page
  // would visibly rearrange itself out of once the clock arrived.
  const organizationEvents = useMemo(() => {
    const all = events ?? [];
    return currentTimeMs === null
      ? all
      : orderOrganizationEvents(all, currentTimeMs);
  }, [currentTimeMs, events]);
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
