import { useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { EventsBrowseViews } from "@/features/events/components/EventsBrowseViews";
import { EventsPageHeader } from "@/features/events/components/EventsPageHeader";
import type { EventBrowseView } from "@/features/events/components/EventViewSelect";
import { Button } from "@/shared/ui/button";
import { useEventsPageData } from "@/features/events/hooks/useEventsPageData";
import type { Event } from "@/shared/types";
import { usePosterLandingConfirmation } from "@/features/qrcode/hooks/usePosterLandingConfirmation";
import { EmptyState } from "@/shared/feedback";
import { Stack } from "@/shared/layout";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";

interface EventsPageContainerProps {
  /** The server's browse snapshot, or null when that fetch failed. */
  initialSnapshot: PaginatedEventsResponse | null;
  initialSchool: string;
}

export function EventsPageContainer({
  initialSnapshot,
  initialSchool,
}: EventsPageContainerProps) {
  usePosterLandingConfirmation();

  const { t } = useTranslation();

  const {
    appliedQueryKey,
    isLoading,
    error,
    refreshEvents,
    totalEvents,
    eventStats,
    goingEventsReady,
    latestAddedEvent,
    currentTimeMs,

    filters,
    orderedEvents,
    allEvents,
  } = useEventsPageData({
    initialSnapshot,
    initialSchool,
  });
  const [view, setView] = useState<EventBrowseView>("grid");
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [hasOpenedDetails, setHasOpenedDetails] = useState(false);

  const selectedEvent = useMemo(() => {
    if (selectedEventId == null) return null;
    return allEvents.find((e) => e.id === selectedEventId) ?? null;
  }, [selectedEventId, allEvents]);

  const handleEventClick = useCallback((event: Event) => {
    setHasOpenedDetails(true);
    setSelectedEventId(event.id);
  }, []);

  const handleCloseEventDetails = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  const handleLatestAddedEventSearch = useCallback(() => {
    if (!latestAddedEvent) {
      return;
    }

    filters.setSearchQuery(latestAddedEvent.title);
  }, [filters, latestAddedEvent]);

  return (
    <>
      <Stack gap={2} data-page-layout={view === "map" ? "viewport" : undefined}>
        <EventsPageHeader
          filters={filters}
          school={initialSchool}
          view={view}
          onViewChange={setView}
          count={isLoading ? null : totalEvents}
          latest={latestAddedEvent ? { item: latestAddedEvent, onSelect: handleLatestAddedEventSearch } : null}
          currentTimeMs={currentTimeMs}
          disabled={isLoading || Boolean(error)}
          eventStatsReady={eventStats !== null}
          goingEventsReady={goingEventsReady}
          appliedQueryKey={appliedQueryKey}
        />

        <Stack
          as="main"
          grow={view === "map"}
          className="relative z-10 w-full"
          role="main"
          aria-label={t("search.ariaLabel")}
        >
          {error ? (
            <EmptyState title={error} action={
              <Button variant="primary" onClick={refreshEvents}>{t("common.tryAgain")}</Button>
            } />
          ) : (
            <EventsBrowseViews
              view={view}
              school={initialSchool}
              events={orderedEvents}
              onEventClick={handleEventClick}
              onClearFilters={filters.clearAllFilters}
              hasActiveFilters={filters.filterCount > 0 || filters.searchQuery.trim().length > 0}
              eventStats={eventStats}
              isLoading={isLoading}
              resetKey={appliedQueryKey}
              groupByDateSections={
                filters.sortBy === "date" && filters.sortOrder === "asc"
              }
            />
          )}
        </Stack>
      </Stack>
      {hasOpenedDetails ? (
        <EventDetailsModal
          eventId={selectedEventId}
          event={selectedEvent}
          onClose={handleCloseEventDetails}
          allEvents={orderedEvents}
          />
      ) : null}
    </>
  );
}
