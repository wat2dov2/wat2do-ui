import { useMemo, type ReactNode } from "react";
import { Search } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { EventCard } from "@/features/events/components/EventCard";
import type { Event } from "@/shared/types";
import { getEventDateCategory, type EventDateCategory } from "@/shared/utils/date";
import { DiaTextReveal } from "@/registry/magicui/dia-text-reveal";
import { Skeleton } from "@/shared/ui/skeleton";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import type { EventStats } from "@/features/events/api/events.api";
import { EmptyState } from "@/shared/feedback";
import { Button } from "@/shared/ui/button";

interface EventListProps {
  events: Event[];
  promotedEvents?: Event[];
  viewMode: "grid" | "calendar" | "map";
  onEventClick?: (event: Event) => void;
  /** Called when the empty-state "Clear filters" button is pressed. */
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
  /** `null` until the live stats query succeeds. */
  eventStats: Record<string, EventStats> | null;
  isLoading?: boolean;
  groupByDateSections?: boolean;
}

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

interface EventCardListItemProps {
  children: ReactNode;
}

interface EventCardsGridProps {
  events: Event[];
  eventStats: Record<string, EventStats> | null;
  onEventClick?: (event: Event) => void;
}

const EVENT_CARD_GRID_CLASS =
  "grid grid-cols-2 gap-2 sm:gap-2.5 min-[480px]:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]";

function EventCardListItem({
  children,
}: EventCardListItemProps) {
  return (
    <div role="listitem" className="min-w-0">
      {children}
    </div>
  );
}

function EventCardsGrid({
  events,
  eventStats,
  onEventClick,
}: EventCardsGridProps) {
  return (
    <div className={EVENT_CARD_GRID_CLASS}>
      {events.map((event) => (
        <EventCardListItem key={event.id}>
          <EventCard
            event={event}
            stats={eventStats?.[String(event.id)]}
            onEventClick={onEventClick}
            mobileClickActivation
          />
        </EventCardListItem>
      ))}
    </div>
  );
}

/**
 * Bucket events into the date sections, in section order.
 *
 * The server returns upcoming-only events, so there is no "past" section. A
 * timezone-skew straggler can still map to "past" (which has no bucket); those
 * are dropped from the grid here - the one place this list decides what's
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
 * Feed ordering happens upstream in `useEventsPageData.orderedEvents`. This
 * component groups by date section afterward while preserving order within
 * each section.
 */
export function EventList({
  events,
  promotedEvents = [],
  viewMode,
  onEventClick,
  onClearFilters,
  hasActiveFilters = false,
  eventStats,
  isLoading = false,
  groupByDateSections = true,
}: EventListProps) {
  const { t } = useTranslation();

  // Filter out promoted events from the main feed date sections so they don't duplicate
  const regularEvents = useMemo(() => {
    const promotedIds = new Set((promotedEvents || []).map((e) => e.id));
    return events.filter((e) => !promotedIds.has(e.id));
  }, [events, promotedEvents]);

  const sectionOrderedEvents = useMemo(() => {
    if (!groupByDateSections) {
      return regularEvents;
    }
    const groups = groupEventsByDateSection(regularEvents);
    return EVENT_DATE_SECTIONS.flatMap(({ category }) => groups[category]);
  }, [groupByDateSections, regularEvents]);
  const groupedVisibleEvents = useMemo(
    () => groupEventsByDateSection(sectionOrderedEvents),
    [sectionOrderedEvents],
  );

  // Early returns AFTER all hooks
  if (isLoading) {
    return (
      <div className="space-y-5">
        <section className="space-y-2.5">
          <Skeleton className="h-5 w-28 rounded-lg" />
          <div className={EVENT_CARD_GRID_CLASS}>
            {Array.from({ length: 12 }).map((_, i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        </section>
      </div>
    );
  }

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
      <EmptyState
        icon={<Search />}
        title={
          hasActiveFilters
            ? t("events.noEventsFound")
            : t("events.noEventsScheduled")
        }
        description={
          hasActiveFilters
            ? t("events.noEventsFoundDesc")
            : t("events.noEventsScheduledDesc")
        }
        action={
          hasActiveFilters && onClearFilters ? (
            <Button variant="secondary" onMouseDown={onClearFilters}>
              {t("events.clearAllFilters")}
            </Button>
          ) : undefined
        }
        className="py-24"
      />
    );
  }

  return (
    <div className="space-y-5" role="list" aria-label={`${events.length} events found`}>
      {/* Promoted Events Section */}
      {promotedEvents && promotedEvents.length > 0 && (
        <section className="space-y-2.5" aria-label={t("events.promotedEvents")}>
          <h2 className="text-base font-normal tracking-normal text-foreground">
            <DiaTextReveal
              text={t("events.promotedEvents")}
              className="text-base font-normal tracking-normal text-foreground"
              textColor="var(--foreground)"
              colors={["#A97CF8", "#F38CB8", "#FDCC92"]}
            />
          </h2>
          <EventCardsGrid
            events={promotedEvents}
            eventStats={eventStats}
            onEventClick={onEventClick}
          />
        </section>
      )}

      {groupByDateSections ? (
        EVENT_DATE_SECTIONS.map(({ category, labelKey }) => {
          const sectionEvents = groupedVisibleEvents[category];
          if (sectionEvents.length === 0) return null;

          return (
            <section key={category} className="space-y-2.5" aria-label={t(labelKey)}>
              <h2 className="text-base font-normal tracking-normal text-foreground">
                {t(labelKey)}
              </h2>
              <EventCardsGrid
                events={sectionEvents}
                eventStats={eventStats}
                onEventClick={onEventClick}
              />
            </section>
          );
        })
      ) : (
        <section className="space-y-2.5" aria-label={t("events.upcoming")}>
          <EventCardsGrid
            events={sectionOrderedEvents}
            eventStats={eventStats}
            onEventClick={onEventClick}
          />
        </section>
      )}
    </div>
  );
}
