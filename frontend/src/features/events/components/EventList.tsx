import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { Search } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { EventCard, type EventCardDialog } from "@/features/events/components/EventCard";
import type { Event } from "@/shared/types";
import { getEventDateCategory, type EventDateCategory } from "@/shared/utils/date";
import { DiaTextReveal } from "@/registry/magicui/dia-text-reveal";
import { Skeleton } from "@/shared/ui/skeleton";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";

interface EventListProps {
  events: Event[];
  promotedEvents?: Event[];
  viewMode: "grid" | "calendar" | "map";
  onEventClick?: (event: Event) => void;
  /** Called when the user confirms deletion on an owned/admin event card. */
  onDelete?: (eventId: number) => void;
  /** Called when the empty-state "Clear filters" button is pressed. */
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
  goingCounts: Record<string, number>;
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

const DeleteEventDialog = lazy(() =>
  import("@/features/events/components/DeleteEventDialog").then((module) => ({
    default: module.DeleteEventDialog,
  })),
);
const EventShareDialog = lazy(() =>
  import("@/features/events/components/EventShareDialog").then((module) => ({
    default: module.EventShareDialog,
  })),
);
const EventReportDialog = lazy(() =>
  import("@/features/events/components/EventReportDialog").then((module) => ({
    default: module.EventReportDialog,
  })),
);

interface ActiveEventDialog {
  type: EventCardDialog;
  event: Event;
}

interface EventCardListItemProps {
  children: ReactNode;
}

interface EventCardsGridProps {
  events: Event[];
  goingCounts: Record<string, number>;
  onEventClick?: (event: Event) => void;
  onDelete?: (eventId: number) => void;
  onActionDialogOpen: (type: EventCardDialog, event: Event) => void;
}

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
  goingCounts,
  onEventClick,
  onDelete,
  onActionDialogOpen,
}: EventCardsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {events.map((event) => (
        <EventCardListItem key={event.id}>
          <EventCard
            event={event}
            goingCount={goingCounts[String(event.id)] ?? 0}
            onEventClick={onEventClick}
            mobileClickActivation
            onDelete={onDelete}
            onActionDialogOpen={onActionDialogOpen}
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
  onDelete,
  onClearFilters,
  hasActiveFilters = false,
  goingCounts,
  isLoading = false,
  groupByDateSections = true,
}: EventListProps) {
  const { t } = useTranslation();
  const [activeDialog, setActiveDialog] = useState<ActiveEventDialog | null>(null);

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
  const handleActionDialogOpen = useCallback((type: EventCardDialog, event: Event) => {
    setActiveDialog({ type, event });
  }, []);

  const handleActionDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setActiveDialog(null);
    }
  }, []);

  const actionDialogs = activeDialog ? (
    <>
      {activeDialog.type === "delete" && (
        <Suspense fallback={null}>
          <DeleteEventDialog
            open
            onOpenChange={handleActionDialogOpenChange}
            eventTitle={activeDialog.event.title}
            onConfirm={() => onDelete?.(activeDialog.event.id)}
          />
        </Suspense>
      )}

      {activeDialog.type === "share" && (
        <Suspense fallback={null}>
          <EventShareDialog
            event={activeDialog.event}
            open
            onOpenChange={handleActionDialogOpenChange}
          />
        </Suspense>
      )}

      {activeDialog.type === "report" && (
        <Suspense fallback={null}>
          <EventReportDialog
            eventId={activeDialog.event.id}
            eventTitle={activeDialog.event.title}
            open
            onOpenChange={handleActionDialogOpenChange}
          />
        </Suspense>
      )}
    </>
  ) : null;

  // Early returns AFTER all hooks
  if (isLoading) {
    return (
      <div className="space-y-5">
        <section className="space-y-2.5">
          <Skeleton className="h-5 w-28 rounded-lg" />
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
      <div className="flex flex-col items-center justify-center py-24 px-4">
        <div className="size-16 rounded-full bg-secondary flex items-center justify-center mb-4">
          <Search className="size-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {hasActiveFilters ? t("events.noEventsFound") : t("events.noEventsScheduled")}
        </h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
          {hasActiveFilters ? t("events.noEventsFoundDesc") : t("events.noEventsScheduledDesc")}
        </p>
        {hasActiveFilters && onClearFilters && (
          <button
            onMouseDown={onClearFilters}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
          >
            {t("events.clearAllFilters")}
          </button>
        )}
      </div>
    );
  }

  return (
    <>
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
              goingCounts={goingCounts}
              onEventClick={onEventClick}
              onDelete={onDelete}
              onActionDialogOpen={handleActionDialogOpen}
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
              goingCounts={goingCounts}
                  onEventClick={onEventClick}
                  onDelete={onDelete}
                  onActionDialogOpen={handleActionDialogOpen}
                />
              </section>
            );
          })
        ) : (
          <section className="space-y-2.5" aria-label={t("events.upcoming")}>
            <EventCardsGrid
              events={sectionOrderedEvents}
              goingCounts={goingCounts}
              onEventClick={onEventClick}
              onDelete={onDelete}
              onActionDialogOpen={handleActionDialogOpen}
            />
          </section>
        )}
      </div>
      {actionDialogs}
    </>
  );
}
