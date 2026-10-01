import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { EventCard } from "@/features/events/components/EventCard";
import type { Event } from "@/shared/types";
import {
  eventCalendarDate,
  eventDateSectionKey,
  eventDateSectionOrder,
  formatEventDateSectionRange,
  getEventDateSection,
  type EventDateSection,
} from "@/shared/utils/date";
import { ScrollDateWheel } from "@/shared/ui/scroll-date-wheel";
import { Skeleton } from "@/shared/ui/skeleton";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import type { EventStats } from "@/features/events/api/events.api";
import { EmptyState } from "@/shared/feedback";
import { Button } from "@/shared/ui/button";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { CardEntrance } from "@/shared/ui/card-entrance";
import { controlBox } from "@/shared/config/controlBox";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import imageDelivery from "../../../../../backend/controlbox/image_delivery.json" with { type: "json" };

interface EventListProps {
  events: Event[];
  onEventClick?: (event: Event) => void;
  /** Called when the empty-state "Clear filters" button is pressed. */
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
  /** `null` until the live stats query succeeds. */
  eventStats: Record<string, EventStats> | null;
  isLoading?: boolean;
  groupByDateSections?: boolean;
  showDateWheel?: boolean;
}

interface EventCardsGridProps {
  dateGroupKey?: string;
  events: Event[];
  eventStats: Record<string, EventStats> | null;
  priorityImageIds: ReadonlySet<number>;
  onEventClick?: (event: Event) => void;
}

function EventCardsGrid({
  dateGroupKey,
  events,
  eventStats,
  priorityImageIds,
  onEventClick,
}: EventCardsGridProps) {
  return (
    <div data-slot="card-grid" data-scroll-date-group={dateGroupKey} className={CARD_GRID_CLASS}>
      {events.map((event, index) => (
        <CardEntrance
          key={event.id}
          index={index}
          role="listitem"
          className="h-full min-w-0"
        >
          <EventCard
            event={event}
            stats={eventStats?.[String(event.id)]}
            imagePriority={priorityImageIds.has(event.id)}
            onEventClick={onEventClick}
          />
        </CardEntrance>
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
function groupEventsByDateSection(events: Event[], getSchoolTimezone: ReturnType<typeof useSchoolDirectory>["getSchoolTimezone"]): DateSectionGroup[] {
  const groups = new Map<string, DateSectionGroup>();

  events.forEach((event) => {
    const section = getEventDateSection(event, getSchoolTimezone(event.school));
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
  onEventClick,
  onClearFilters,
  hasActiveFilters = false,
  eventStats,
  isLoading = false,
  groupByDateSections = true,
  showDateWheel = false,
}: EventListProps) {
  const { getSchoolTimezone } = useSchoolDirectory();
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en-US";
  const [visibleEventCount, setVisibleEventCount] = useState(
    controlBox.eventDiscovery.initialRenderCount,
  );
  const resultKey = useMemo(() => events.map((event) => event.id).join(","), [events]);
  const [previousResultKey, setPreviousResultKey] = useState(resultKey);
  // Reset before rendering children: an effect would first mount the entire
  // previously expanded list on every filter edit. Stats-only updates keep it.
  if (previousResultKey !== resultKey) {
    setPreviousResultKey(resultKey);
    setVisibleEventCount(controlBox.eventDiscovery.initialRenderCount);
  }
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const dateSectionGroups = useMemo(
    () => groupByDateSections ? groupEventsByDateSection(events, getSchoolTimezone) : [],
    [events, getSchoolTimezone, groupByDateSections],
  );
  const wheelGroups = useMemo(
    () => showDateWheel && !hasActiveFilters && groupByDateSections
      ? dateSectionGroups.map(group => ({
          key: group.key,
          dates: group.events.map(event => eventCalendarDate(event, getSchoolTimezone(event.school))),
        }))
      : undefined,
    [dateSectionGroups, getSchoolTimezone, groupByDateSections, hasActiveFilters, showDateWheel],
  );
  const sectionOrderedEvents = useMemo(
    () =>
      groupByDateSections
        ? dateSectionGroups.flatMap((group) => group.events)
        : events,
    [dateSectionGroups, groupByDateSections, events],
  );
  const visibleEvents = useMemo(
    () => sectionOrderedEvents.slice(0, visibleEventCount),
    [sectionOrderedEvents, visibleEventCount],
  );
  const visibleDateSectionGroups = useMemo(
    () => {
      let remaining = visibleEventCount;
      const groups: DateSectionGroup[] = [];
      for (const group of dateSectionGroups) {
        if (remaining <= 0) break;
        const sectionEvents = group.events.slice(0, remaining);
        remaining -= sectionEvents.length;
        groups.push({ ...group, events: sectionEvents });
      }
      return groups;
    },
    [dateSectionGroups, visibleEventCount],
  );
  const priorityImageIds = useMemo(
    () =>
      new Set(
        visibleEvents
          .slice(0, imageDelivery.first_row_image_count)
          .map((event) => event.id),
      ),
    [visibleEvents],
  );
  const hasMoreEvents = visibleEvents.length < sectionOrderedEvents.length;
  const loadMoreEvents = useCallback(() => {
    setVisibleEventCount((count) =>
      Math.min(
        count + controlBox.eventDiscovery.initialRenderCount,
        sectionOrderedEvents.length,
      ),
    );
  }, [sectionOrderedEvents.length]);

  useEffect(() => {
    if (!hasMoreEvents) return;

    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadMoreEvents();
        }
      },
      { rootMargin: "400px", threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreEvents, loadMoreEvents]);

  const sectionLabel = (section: EventDateSection): string => {
    if (section.kind === "today") return t("events.dateSections.today");
    if (section.kind === "tomorrow") return t("events.dateSections.tomorrow");
    return formatEventDateSectionRange(section.startMs, section.endMs, t, locale);
  };

  const dateWheel = showDateWheel
    ? <ScrollDateWheel undatedLabel={t("events.upcoming")} groups={wheelGroups} />
    : null;

  // Early returns AFTER all hooks
  if (isLoading) {
    return (
      <>
        {dateWheel}
        <div className="space-y-5" aria-busy="true">
          <section className="space-y-2.5">
            <Skeleton className="h-5 w-28 rounded-lg" />
            <div className={CARD_GRID_CLASS}>
              {Array.from({ length: 12 }).map((_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          </section>
        </div>
      </>
    );
  }

  // Guard on what will actually render, not on the raw input: date sectioning
  // can drop events, and checking `events.length` here would render a feed of
  // zero cards with no empty state at all.
  if (sectionOrderedEvents.length === 0) {
    return (
      <>
        {dateWheel}
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
              <Button variant="outline" onMouseDown={onClearFilters}>
                {t("events.clearAllFilters")}
              </Button>
            ) : undefined
          }
          className="py-24"
        />
      </>
    );
  }

  return (
    <>
      {dateWheel}
      <div className="space-y-5" role="list" aria-label={`${events.length} events found`}>

        {groupByDateSections ? (
          visibleDateSectionGroups.map((group) => {
            const label = sectionLabel(group.section);
            return (
              <section key={group.key} data-scroll-date-section className="space-y-2.5" aria-label={label}>
                <h2 className="text-base font-normal tracking-normal text-foreground">
                  {label}
                </h2>
                <EventCardsGrid
                  dateGroupKey={group.key}
                  events={group.events}
                  eventStats={eventStats}
                  priorityImageIds={priorityImageIds}
                  onEventClick={onEventClick}
                />
              </section>
            );
          })
        ) : (
          <section className="space-y-2.5" aria-label={t("events.upcoming")}>
            <EventCardsGrid
              events={visibleEvents}
              eventStats={eventStats}
              priorityImageIds={priorityImageIds}
              onEventClick={onEventClick}
            />
          </section>
        )}
        {hasMoreEvents ? (
          <div
            ref={loadMoreRef}
            data-testid="event-list-sentinel"
            className={CARD_GRID_CLASS}
            role="status"
            aria-live="polite"
            aria-label={t("common.loading")}
          >
            {Array.from({ length: 4 }, (_, index) => <EventCardSkeleton key={index} />)}
          </div>
        ) : null}
      </div>
    </>
  );
}
