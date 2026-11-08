import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
/**
 * Onboarding event grid: the school's events that are still to come, the most
 * clicked first, two to a row, loading more as the reader scrolls until there
 * are no more. Uses the same card style as the auth page hero section.
 * User can multi-select (optional).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveSchool } from "@/shared/constants/schools";
import { useTranslation } from "react-i18next";
import {
  PreviewStyleEventCard,
  HERO_CARD_PLACEHOLDER_HEIGHT,
  eventToPreview,
} from "@/features/auth";
import {
  eventFeedQueryOptions,
  useCurrentTime,
  useEventStats,
  useEventsStore,
} from "@/features/events";
import { useProgressiveList } from "@/shared/hooks/useProgressiveList";
import { getPrimaryOccurrence, hasActiveEventOccurrence } from "@/shared/utils/date";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import type { Event } from "@/shared/types";

/** Two rows of four cards a batch: a screen's worth, with the next batch loading below it. */
const EVENTS_PER_BATCH = 8;
const GRID_CLASS = "grid grid-cols-2 gap-4 w-full max-w-2xl mx-auto";

function CardPlaceholder() {
  return <Skeleton className="rounded-xl" style={{ height: HERO_CARD_PLACEHOLDER_HEIGHT }} />;
}

function startMs(event: Event): number {
  const start = getPrimaryOccurrence(event)?.dtstart_utc;
  return start ? Date.parse(start) : Number.POSITIVE_INFINITY;
}

interface OnboardingEventGridProps {
  selectedEventIds: number[];
  onToggleEventId: (eventId: number) => void;
  className?: string;
}

export function OnboardingEventGrid({
  selectedEventIds,
  onToggleEventId,
  className,
}: OnboardingEventGridProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();

  const school = resolveSchool(useEventsStore((state) => state.schoolFilter));
  const { data, isLoading: feedLoading } = useQuery(eventFeedQueryOptions(school));
  // The order waits for the click counts, so cards never reshuffle under the reader.
  const { data: stats, isPending: statsPending } = useEventStats(school);
  const now = useCurrentTime();
  const loading = feedLoading || statsPending || now === null;

  const locale = i18n.language || "en-US";

  // Events still to come (or on now), the ones students click most first, then the soonest.
  const events = useMemo(() => {
    if (!data || now === null) return [];
    const clicks = (event: Event) => stats?.[String(event.id)]?.click_count ?? 0;
    return data.items
      .filter((event) => hasActiveEventOccurrence(event, now))
      .sort((first, second) => clicks(second) - clicks(first) || startMs(first) - startMs(second));
  }, [data, stats, now]);
  // A fixed key: the clock ticking or stats refreshing never sends the reader back to the top.
  const { visibleItems, hasMore, loadMoreRef } = useProgressiveList(events, EVENTS_PER_BATCH, "onboarding-events");

  const previewEvents = useMemo(
    () => visibleItems.map((e) => ({ event: e, preview: eventToPreview(e, getSchoolTimezone(e.school), locale, t) })),
    [visibleItems, locale, t, getSchoolTimezone],
  );

  if (loading) {
    return (
      <div className={cn(GRID_CLASS, "min-h-[360px] place-content-start", className)} aria-busy>
        {Array.from({ length: EVENTS_PER_BATCH }).map((_, i) => (
          <CardPlaceholder key={i} />
        ))}
      </div>
    );
  }

  if (previewEvents.length === 0) {
    return (
      <div
        className={cn(
          "text-sm text-muted-foreground text-center py-8 max-w-md mx-auto",
          className
        )}
      >
        {t("onboarding.events.noEventsAvailable", "No events right now. You can continue without selecting.")}
      </div>
    );
  }

  return (
    <div
      className={cn(GRID_CLASS, className)}
      role="list"
      aria-label={t("onboarding.events.selectAriaLabel", "Select events that catch your eye")}
    >
      {previewEvents.map(({ event, preview }) => {
        const isSelected = selectedEventIds.includes(event.id);
        return (
          <PreviewStyleEventCard
            key={event.id}
            event={preview}
            selected={isSelected}
            onMouseDown={() => onToggleEventId(event.id)}
            data-event-id={event.id}
          />
        );
      })}
      {hasMore ? (
        <div ref={loadMoreRef} aria-hidden="true">
          <CardPlaceholder />
        </div>
      ) : null}
    </div>
  );
}
