import React, { useMemo } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EventCard } from "@/features/events/components/EventCard";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { usePromotionsStore } from "@/features/credits";
import { idArrayEqual } from "@/shared/hooks/useShallowIdArrayEquality";
import type { Event } from "@/shared/types";

interface EventListProps {
  events: Event[];
  viewMode: "grid" | "calendar" | "map";
  onEventClick?: (event: Event) => void;
  disableModal?: boolean;
  /** Called when the user confirms deletion on an owned/admin event card. */
  onDelete?: (eventId: number) => void;
  /** Called when the empty-state "Clear filters" button is pressed. */
  onClearFilters?: () => void;
}

/**
 * Event list component.
 *
 * Reads saved/promoted IDs directly from their respective stores so that any
 * card — including cards rendered inside `EventDetailsModal`'s similar-events
 * grid — stays in sync without needing a context wrapper.
 * Ordering (promoted first, recommended score) happens upstream in
 * `useEventsPageData.orderedEvents`; this component only renders.
 */
export function EventList({
  events,
  viewMode,
  onEventClick,
  disableModal,
  onDelete,
  onClearFilters,
}: EventListProps) {
  const { t } = useTranslation();
  const savedEventIds = useSavedEventsStore((s) => s.savedEventIds);
  // Custom equality: the store re-sets this array on every reconcile, so the
  // reference changes even when the ID set is identical. Compare element-wise
  // to avoid unnecessary re-renders.
  const activePromotedEventIds = usePromotionsStore(
    (s) => s.activePromotedEventIds,
    idArrayEqual,
  );

  // Wrap id arrays in Sets for O(1) membership lookups per card.
  const savedSet = useMemo(
    () => new Set(savedEventIds),
    [savedEventIds],
  );
  const promotedSet = useMemo(
    () => new Set(activePromotedEventIds),
    [activePromotedEventIds],
  );

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
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
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
      {events.map((event) => (
        <div
          key={event.id}
          role="listitem"
          style={{
            contentVisibility: "auto",
          }}
        >
          <EventCard
            event={event}
            isSaved={savedSet.has(event.id)}
            isPromoted={promotedSet.has(event.id)}
            onEventClick={onEventClick}
            disableModal={disableModal}
            onDelete={onDelete}
          />
        </div>
      ))}
    </div>
  );
}
