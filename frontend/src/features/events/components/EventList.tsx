import React, { useMemo } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EventCard } from "@/features/events/components/EventCard";
import { useEventsContext } from "@/features/events/context/EventsContext";
import { getUniqueEvents } from "@/shared/utils/event";
import type { Event } from "@/shared/types";

interface EventListProps {
  events: Event[];
  viewMode: "grid" | "calendar" | "map";
  onEventClick?: (event: Event) => void;
  disableModal?: boolean;
}

/**
 * Event list component
 * Follows Vercel React best practices for rendering performance
 * Uses content-visibility CSS for performance boost
 * Uses EventsContext to reduce prop drilling
 */
export function EventList({
  events,
  viewMode,
  onEventClick,
  disableModal,
}: EventListProps) {
  const { t } = useTranslation();
  const {
    savedEventIds,
    activePromotedEventIds,
    onClearFilters,
  } = useEventsContext();

  // Deduplicate and sort promoted events to the top - MUST be called before any early returns
  const sortedEvents = useMemo(() => {
    // First deduplicate events by ID to prevent duplicate key warnings
    const uniqueEvents = getUniqueEvents(events);
    // Then sort promoted events to the top
    return [...uniqueEvents].sort((a, b) => {
      const aPromoted = activePromotedEventIds.includes(a.id);
      const bPromoted = activePromotedEventIds.includes(b.id);
      if (aPromoted && !bPromoted) return -1;
      if (!aPromoted && bPromoted) return 1;
      return 0;
    });
  }, [events, activePromotedEventIds]);

  // Early returns AFTER all hooks
  if (viewMode === "calendar") {
    return (
      <div className="text-center py-32 text-muted-foreground">
        {t("events.calendarViewComingSoon")}
      </div>
    );
  }

  if (viewMode === "map") {
    return (
      <div className="text-center py-32 text-muted-foreground">
        {t("events.mapViewComingSoon")}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Search className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {t("events.noEventsFound")}
        </h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
          {t("events.noEventsFoundDesc")}
        </p>
        {onClearFilters && (
          <button
            onClick={onClearFilters}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
          >
            {t("events.clearAllFilters")}
          </button>
        )}
      </div>
    );
  }

  // Grid view with content-visibility for performance
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4"
      role="list"
      aria-label={`${events.length} events found`}
    >
      {sortedEvents.map((event) => (
        <div
          key={event.id}
          role="listitem"
          style={{
            contentVisibility: "auto",
          }}
        >
          <EventCard
            event={event}
            isSaved={savedEventIds.includes(event.id)}
            isPromoted={activePromotedEventIds.includes(event.id)}
            onEventClick={onEventClick}
            disableModal={disableModal}
          />
        </div>
      ))}
    </div>
  );
}
