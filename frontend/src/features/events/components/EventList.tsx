import { useMemo, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EventCard } from "@/features/events/components/EventCard";
import type { Event } from "@/shared/types";
import { formatEventDateSectionRange, type EventDateSection } from "@/shared/utils/date";
import { groupEventsByDateSection, type DateSectionGroup } from "@/features/events/lib/eventDateSections";
import { SkeletonLine } from "@/shared/ui/skeleton";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import type { EventStats } from "@/features/events/api/events.api";
import { EmptyState } from "@/shared/feedback";
import { Stack } from "@/shared/layout/stack";
import { Button } from "@/shared/ui/button";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { CardEntrance } from "@/shared/ui/card-entrance";
import { useProgressiveList } from "@/shared/hooks/useProgressiveList";
import { controlBox } from "@/shared/config/controlBox";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import imageDelivery from "../../../../../backend/controlbox/image_delivery.json" with { type: "json" };

const DATE_SECTION_HEADING_CLASS = "text-base font-normal tracking-normal text-foreground";

interface EventListProps {
  events: Event[];
  onEventClick?: (event: Event) => void;
  /** Called when the empty-state "Clear filters" button is pressed. */
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
  /** The start filter is before now, so ended events may be listed; they close the list in a Past section. */
  includePast?: boolean;
  /**
   * Offered beside "Clear filters" when a search or filter finds nothing: lifts
   * the start filter so past events matching the same query load.
   */
  onShowPastEvents?: () => void;
  /** `null` until the live stats query succeeds. */
  eventStats: Record<string, EventStats> | null;
  isLoading?: boolean;
  groupByDateSections?: boolean;
  /** The reader's query (search, filters, sort); only a change here returns the list to its first batch. */
  resetKey?: string;
  /**
   * The whole list's length while `events` holds only its start (the server's
   * first screen, until the complete feed arrives). The list then keeps the
   * loading row below its first batch and announces the whole count, exactly
   * as the complete list will, so nothing moves when the rest arrives.
   */
  totalCount?: number;
  /** Laid over the list's loading placeholders once the events they wait for have failed to load. */
  loadFailureNotice?: ReactNode;
}

interface EventCardsGridProps {
  events: Event[];
  eventStats: Record<string, EventStats> | null;
  priorityImageIds: ReadonlySet<number>;
  onEventClick?: (event: Event) => void;
}

function EventCardsGrid({
  events,
  eventStats,
  priorityImageIds,
  onEventClick,
}: EventCardsGridProps) {
  return (
    <div data-slot="card-grid" className={CARD_GRID_CLASS}>
      {events.map((event, index) => (
        <CardEntrance
          key={event.id}
          entryKey={`event-${event.id}`}
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
  includePast = false,
  onShowPastEvents,
  eventStats,
  isLoading = false,
  groupByDateSections = true,
  resetKey,
  totalCount,
  loadFailureNotice,
}: EventListProps) {
  const { getSchoolTimezone } = useSchoolDirectory();
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en-US";
  const dateSectionGroups = useMemo(
    () => groupByDateSections ? groupEventsByDateSection(events, getSchoolTimezone, new Date(), includePast) : [],
    [events, getSchoolTimezone, groupByDateSections, includePast],
  );
  const sectionOrderedEvents = useMemo(
    () =>
      groupByDateSections
        ? dateSectionGroups.flatMap((group) => group.events)
        : events,
    [dateSectionGroups, groupByDateSections, events],
  );
  const { visibleItems: visibleEvents, visibleCount: visibleEventCount, hasMore: hasMoreLoaded, loadMoreRef } = useProgressiveList(sectionOrderedEvents, controlBox.eventDiscovery.initialRenderCount, resetKey);
  // Past a first screen, the next cards are still on their way: the loading row stays
  // where the complete list will have it, and fills in once those cards arrive.
  const hasMoreEvents = hasMoreLoaded || (totalCount !== undefined && visibleEventCount < totalCount);
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
  const sectionLabel = (section: EventDateSection): string => {
    if (section.kind === "today") return t("events.dateSections.today");
    if (section.kind === "tomorrow") return t("events.dateSections.tomorrow");
    if (section.kind === "past") return t("events.dateSections.past");
    return formatEventDateSectionRange(section.startMs, section.endMs, t, locale);
  };

  // Early returns AFTER all hooks
  if (isLoading) {
    return (
      // Once the load has failed nothing is busy, and the notice must be announced.
      <div className="relative space-y-5" aria-busy={loadFailureNotice ? undefined : true}>
        {/* First, so the section stays the last child and keeps its spacing. */}
        {loadFailureNotice}
        <section className="space-y-2.5">
          {groupByDateSections ? (
            <h2 data-skeleton-key="date-heading" className={DATE_SECTION_HEADING_CLASS}>
              <SkeletonLine className="w-28" />
            </h2>
          ) : null}
          <div className={CARD_GRID_CLASS}>
            {Array.from({ length: controlBox.eventDiscovery.initialRenderCount }, (_, i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        </section>
      </div>
    );
  }

  // Guard on what will actually render, not on the raw input: date sectioning
  // can drop events, and checking `events.length` here would render a feed of
  // zero cards with no empty state at all. Events still on their way are not an
  // empty list.
  if (sectionOrderedEvents.length === 0 && !hasMoreEvents) {
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
          hasActiveFilters && (onClearFilters || onShowPastEvents) ? (
            <Stack direction="horizontal" gap={2} justify="center" wrap>
              {onClearFilters ? (
                <Button variant="outline" onMouseDown={onClearFilters}>
                  {t("events.clearAllFilters")}
                </Button>
              ) : null}
              {onShowPastEvents ? (
                <Button variant="outline" onClick={onShowPastEvents}>
                  {t("events.seePastEvents")}
                </Button>
              ) : null}
            </Stack>
          ) : undefined
        }
        className="py-24"
      />
    );
  }

  return (
    <div className="space-y-5" role="list" aria-label={`${totalCount ?? events.length} events found`}>
      {groupByDateSections ? (
        visibleDateSectionGroups.map((group) => {
          const label = sectionLabel(group.section);
          return (
            <section key={group.key} className="space-y-2.5" aria-label={label}>
              <h2 data-skeleton-key="date-heading" className={DATE_SECTION_HEADING_CLASS}>
                {label}
              </h2>
              <EventCardsGrid
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
          className={`relative ${CARD_GRID_CLASS}`}
          role="status"
          aria-live="polite"
          aria-label={t("common.loading")}
        >
          {Array.from({ length: 4 }, (_, index) => <EventCardSkeleton key={index} />)}
          {loadFailureNotice}
        </div>
      ) : null}
    </div>
  );
}
