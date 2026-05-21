import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EventCard } from "@/features/events/components/EventCard";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { usePromotionsStore } from "@/features/credits";
import { useShallow } from "zustand/react/shallow";
import type { Event } from "@/shared/types";
import { getEventDateCategory, type EventDateCategory } from "@/shared/utils/date";

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

const INITIAL_RENDER_COUNT = 8;
const RENDER_CHUNK_SIZE = 24;
const EVENT_DATE_SECTIONS: Array<{
  category: EventDateCategory;
  labelKey: string;
}> = [
  { category: "today", labelKey: "events.dateSections.today" },
  { category: "tomorrow", labelKey: "events.dateSections.tomorrow" },
  { category: "later this week", labelKey: "events.dateSections.laterThisWeek" },
  { category: "later this month", labelKey: "events.dateSections.laterThisMonth" },
  { category: "later", labelKey: "events.dateSections.later" },
  { category: "past", labelKey: "events.dateSections.past" },
];

/**
 * Event list component.
 *
 * Reads saved/promoted IDs directly from their respective stores so that any
 * card — including cards rendered inside `EventDetailsModal`'s similar-events
 * grid — stays in sync without needing a context wrapper.
 * Ordering (promoted first, recommended score) happens upstream in
 * `useEventsPageData.orderedEvents`; this component preserves that order
 * inside date sections.
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
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const savedEventIds = useSavedEventsStore((s) => s.savedEventIds);
  // Custom equality: the store re-sets this array on every reconcile, so the
  // reference changes even when the ID set is identical. ``useShallow`` does
  // element-wise reference equality on the array to avoid unnecessary re-renders.
  // (Zustand v5 dropped the second-arg equalityFn — useShallow is the v5 idiom.)
  const activePromotedEventIds = usePromotionsStore(
    useShallow((s) => s.activePromotedEventIds),
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
  const visibleEvents = useMemo(
    () => events.slice(0, Math.min(visibleCount, events.length)),
    [events, visibleCount],
  );
  const groupedVisibleEvents = useMemo(() => {
    const groups = EVENT_DATE_SECTIONS.reduce(
      (acc, { category }) => {
        acc[category] = [];
        return acc;
      },
      {} as Record<EventDateCategory, Event[]>,
    );

    visibleEvents.forEach((event) => {
      groups[getEventDateCategory(event)].push(event);
    });

    return groups;
  }, [visibleEvents]);

  useEffect(() => {
    if (visibleCount >= events.length) return;
    const id = window.setTimeout(() => {
      setVisibleCount((count) => Math.min(count + RENDER_CHUNK_SIZE, events.length));
    }, 140);
    return () => window.clearTimeout(id);
  }, [events.length, visibleCount]);

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
        <div className="size-16 rounded-full bg-secondary flex items-center justify-center mb-4">
          <Search className="size-8 text-muted-foreground" />
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
    <div className="space-y-8" role="list" aria-label={`${events.length} events found`}>
      {EVENT_DATE_SECTIONS.map(({ category, labelKey }) => {
        const sectionEvents = groupedVisibleEvents[category];
        if (sectionEvents.length === 0) return null;

        return (
          <section key={category} className="space-y-3" aria-label={t(labelKey)}>
            <h2 className="text-lg font-semibold tracking-normal text-foreground">
              {t(labelKey)}
            </h2>
            <div
              className="grid justify-center gap-4"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 260px))",
              }}
            >
              {sectionEvents.map((event) => (
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
          </section>
        );
      })}
    </div>
  );
}
