import { useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { EVENT_MAP_VIEW_CLASS, EventsBrowseViews } from "@/features/events/components/EventsBrowseViews";
import { EventsPageHeader } from "@/features/events/components/EventsPageHeader";
import { EventHighlightSections } from "@/features/events/components/EventHighlightSections";
import { DEFAULT_EVENT_VIEW, type EventBrowseView } from "@/features/events/components/EventViewSelect";
import { Button } from "@/shared/ui/button";
import { useEventsPageData } from "@/features/events/hooks/useEventsPageData";
import type { Event } from "@/shared/types";
import { usePosterLandingConfirmation } from "@/features/qrcode/hooks/usePosterLandingConfirmation";
import { EmptyState, LoadFailureNotice } from "@/shared/feedback";
import { Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import { START_FROM_NOW } from "@/shared/constants/eventFilters";
import type { EventFeedFirstScreen } from "@/features/events/lib/eventFeedFirstScreen";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";

const NO_EVENTS: Event[] = [];

interface EventsPageContainerProps {
  /** The server's first screen of the feed, or null when it could not read the feed. */
  firstScreen: EventFeedFirstScreen | null;
  initialSchool: string;
}

export function EventsPageContainer({
  firstScreen,
  initialSchool,
}: EventsPageContainerProps) {
  usePosterLandingConfirmation();

  const { t } = useTranslation();

  const {
    appliedQueryKey,
    isLoading,
    error,
    restLoadFailed,
    isRefreshing,
    refreshEvents,
    listing,
    eventStats,
    goingEventsReady,
    latestAddedEvent,
    currentTimeMs,

    filters,
    allEvents,
    highlights,
  } = useEventsPageData({
    firstScreen,
    initialSchool,
  });
  const [view, setView] = useState<EventBrowseView>(DEFAULT_EVENT_VIEW);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [hasOpenedDetails, setHasOpenedDetails] = useState(false);
  // The row an event was opened from (the featured cards), which the drawer's arrows step through.
  const [openedFromRow, setOpenedFromRow] = useState<readonly Event[] | null>(null);

  const selectedEvent = useMemo(() => {
    if (selectedEventId == null) return null;
    return allEvents.find((e) => e.id === selectedEventId) ?? null;
  }, [selectedEventId, allEvents]);

  const handleEventClick = useCallback((event: Event, row?: readonly Event[]) => {
    setHasOpenedDetails(true);
    setOpenedFromRow(row ?? null);
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

  const { setStartFrom } = filters;
  // Lifts the start filter alone; the search and every other filter stay.
  const showPastEvents = useCallback(() => setStartFrom(""), [setStartFrom]);

  const hasActiveFilters = filters.filterCount > 0 || filters.searchQuery.trim().length > 0;
  // The highlights stay above every view through any search or filter (the filter
  // bar keeps the results in view), so the reader can always scroll back up to
  // them.
  const showHighlights = !error;
  // Everything waiting for the rest of the feed says so the same way, with a way to try again.
  const loadFailureNotice = restLoadFailed ? (
    <LoadFailureNotice message={t("events.loadFailed")} onRetry={refreshEvents} retrying={isRefreshing} />
  ) : undefined;

  return (
    <>
      <Stack gap={2}>
        {showHighlights ? (
          <EventHighlightSections highlights={highlights} eventStats={eventStats} onEventClick={handleEventClick} />
        ) : null}
        <EventsPageHeader
          filters={filters}
          school={initialSchool}
          view={view}
          onViewChange={setView}
          count={listing?.total ?? null}
          latest={latestAddedEvent ? { item: latestAddedEvent, onSelect: handleLatestAddedEventSearch } : null}
          currentTimeMs={currentTimeMs}
          disabled={isLoading || Boolean(error)}
          eventStatsReady={eventStats !== null}
          goingEventsReady={goingEventsReady}
          appliedQueryKey={appliedQueryKey}
        />

        <Stack
          as="main"
          className={cn("relative z-10 w-full", view === "map" && EVENT_MAP_VIEW_CLASS)}
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
              events={listing?.events ?? NO_EVENTS}
              totalCount={listing?.complete === false ? listing.total : undefined}
              onEventClick={handleEventClick}
              onClearFilters={filters.clearAllFilters}
              hasActiveFilters={hasActiveFilters}
              includePast={filters.startFrom !== START_FROM_NOW}
              onShowPastEvents={filters.startFrom ? showPastEvents : undefined}
              eventStats={eventStats}
              isLoading={listing === null}
              loadFailureNotice={loadFailureNotice}
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
          allEvents={listing?.complete ? listing.events : null}
          navigationEvents={openedFromRow}
          />
      ) : null}
    </>
  );
}
