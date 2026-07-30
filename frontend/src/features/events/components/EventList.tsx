import { useMemo, type ReactNode } from "react";
import { Search } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { EventCard } from "@/features/events/components/EventCard";
import type { Event } from "@/shared/types";
import {
  eventDateSectionKey,
  eventDateSectionOrder,
  formatEventDateSectionRange,
  getEventDateSection,
  type EventDateSection,
} from "@/shared/utils/date";
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

interface EventCardListItemProps {
  children: ReactNode;
}

interface EventCardsGridProps {
  events: Event[];
  eventStats: Record<string, EventStats> | null;
  onEventClick?: (event: Event) => void;
}

// Match the minimum track to the card image height so cards never collapse into
// a narrow portrait sliver on mid-width viewports.
const EVENT_CARD_GRID_CLASS =
  "grid grid-cols-2 gap-2 sm:gap-2.5 min-[480px]:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]";

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

interface DateSectionGroup {
  key: string;
  section: EventDateSection;
  events: Event[];
}

/**
 * Bucket events into date sections, ordered Today, Tomorrow, then week by week.
 *
 * Sections are derived from the events themselves, so only weeks that actually
 * have events get a heading. The server returns upcoming-only events; a
 * timezone-skew straggler can still land in the past and is dropped here - the
 * one place this list decides what's shown, so callers bucket unconditionally.
 */
function groupEventsByDateSection(events: Event[]): DateSectionGroup[] {
  const groups = new Map<string, DateSectionGroup>();

  events.forEach((event) => {
    const section = getEventDateSection(event);
    if (!section) return;

    const key = eventDateSectionKey(section);
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(event);
      return;
    }
    groups.set(key, { key, section, events: [event] });
  });

  return [...groups.values()].sort(
    (a, b) => eventDateSectionOrder(a.section) - eventDateSectionOrder(b.section),
  );
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
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en-US";

  // Filter out promoted events from the main feed date sections so they don't duplicate
  const regularEvents = useMemo(() => {
    const promotedIds = new Set((promotedEvents || []).map((e) => e.id));
    return events.filter((e) => !promotedIds.has(e.id));
  }, [events, promotedEvents]);

  const dateSectionGroups = useMemo(
    () => groupEventsByDateSection(regularEvents),
    [regularEvents],
  );
  const sectionOrderedEvents = useMemo(
    () =>
      groupByDateSections
        ? dateSectionGroups.flatMap((group) => group.events)
        : regularEvents,
    [dateSectionGroups, groupByDateSections, regularEvents],
  );

  const sectionLabel = (section: EventDateSection): string => {
    if (section.kind === "today") return t("events.dateSections.today");
    if (section.kind === "tomorrow") return t("events.dateSections.tomorrow");
    return formatEventDateSectionRange(section.startMs, section.endMs, t, locale);
  };

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

  // Guard on what will actually render, not on the raw input: date sectioning
  // can drop events, and checking `events.length` here would render a feed of
  // zero cards with no empty state at all.
  if (promotedEvents.length === 0 && sectionOrderedEvents.length === 0) {
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
        dateSectionGroups.map((group) => {
          const label = sectionLabel(group.section);
          return (
            <section key={group.key} className="space-y-2.5" aria-label={label}>
              <h2 className="text-base font-normal tracking-normal text-foreground">
                {label}
              </h2>
              <EventCardsGrid
                events={group.events}
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
