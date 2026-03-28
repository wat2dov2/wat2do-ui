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

  const getRandomTilt = (eventId: number): number => {
    // Deterministic pseudo-random tilt so cards stay stable between renders.
    const seeded = Math.sin(eventId * 12.9898) * 43758.5453;
    const normalized = seeded - Math.floor(seeded);
    return normalized * 2.8 - 1.4;
  };

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
    <div className="corkboard-event-grid">
      <span className="corkboard-pin-dot left-4 top-4" aria-hidden />
      <span className="corkboard-pin-dot right-6 top-5" aria-hidden />
      <span className="corkboard-pin-dot bottom-5 left-6" aria-hidden />

      <div
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 md:gap-6"
        role="list"
        aria-label={`${events.length} events found`}
      >
        {sortedEvents.map((event, index) => (
          <div
            key={event.id}
            role="listitem"
            className="will-change-transform"
            style={{
              contentVisibility: "auto",
              transform: `rotate(${getRandomTilt(event.id).toFixed(2)}deg)`,
            }}
          >
            <EventCard
              event={event}
              cardIndex={index}
              isSaved={savedEventIds.includes(event.id)}
              isPromoted={activePromotedEventIds.includes(event.id)}
              onEventClick={onEventClick}
              disableModal={disableModal}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
