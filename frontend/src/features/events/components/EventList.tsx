import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EventCard } from "@/features/events/components/EventCard";
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
  savedEventIds: number[];
  activePromotedEventIds: number[];
}

const INITIAL_RENDER_COUNT = 24;
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
];

/**
 * Bucket events into the date sections, in section order.
 *
 * The server returns upcoming-only events, so there is no "past" section. A
 * timezone-skew straggler can still map to "past" (which has no bucket); those
 * are dropped from the grid here — the one place this list decides what's
 * shown, so callers can bucket unconditionally.
 */
function groupEventsByDateSection(events: Event[]): Record<EventDateCategory, Event[]> {
  const groups = EVENT_DATE_SECTIONS.reduce(
    (acc, { category }) => {
      acc[category] = [];
      return acc;
    },
    {} as Record<EventDateCategory, Event[]>,
  );

  events.forEach((event) => {
    const bucket = groups[getEventDateCategory(event)];
    if (bucket) bucket.push(event);
  });

  return groups;
}

/**
 * Event list component.
 *
 * Promoted/recommended ordering happens upstream in `useEventsPageData.orderedEvents`.
 * This component groups by date section afterward, so date sections outrank
 * the global promoted/recommended order.
 */
export function EventList({
  events,
  viewMode,
  onEventClick,
  disableModal,
  onDelete,
  onClearFilters,
  savedEventIds,
  activePromotedEventIds,
}: EventListProps) {
  const { t } = useTranslation();
  const [requestedVisibleCount, setRequestedVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Wrap id arrays in Sets for O(1) membership lookups per card.
  const savedSet = useMemo(
    () => new Set(savedEventIds),
    [savedEventIds],
  );
  const promotedSet = useMemo(
    () => new Set(activePromotedEventIds),
    [activePromotedEventIds],
  );
  const visibleCount = Math.min(
    Math.max(requestedVisibleCount, INITIAL_RENDER_COUNT),
    events.length,
  );
  const sectionOrderedEvents = useMemo(() => {
    const groups = groupEventsByDateSection(events);
    return EVENT_DATE_SECTIONS.flatMap(({ category }) => groups[category]);
  }, [events]);
  const visibleEvents = useMemo(
    () => sectionOrderedEvents.slice(0, Math.min(visibleCount, sectionOrderedEvents.length)),
    [sectionOrderedEvents, visibleCount],
  );
  const groupedVisibleEvents = useMemo(
    () => groupEventsByDateSection(visibleEvents),
    [visibleEvents],
  );

  useEffect(() => {
    if (visibleCount >= events.length) return;
    const loadMoreNode = loadMoreRef.current;
    if (!loadMoreNode) return;

    const scrollRoot = document.querySelector(".main-content-grid");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setRequestedVisibleCount((count) => Math.min(count + RENDER_CHUNK_SIZE, events.length));
      },
      {
        root: scrollRoot,
        rootMargin: "800px 0px",
      },
    );

    observer.observe(loadMoreNode);
    return () => observer.disconnect();
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
              className="grid gap-4"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 13.5rem), 1fr))",
              }}
            >
              {sectionEvents.map((event) => (
                <div
                  key={event.id}
                  role="listitem"
                  className="min-w-0"
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
      {visibleCount < events.length && (
        <div ref={loadMoreRef} aria-hidden="true" className="h-px" />
      )}
    </div>
  );
}
