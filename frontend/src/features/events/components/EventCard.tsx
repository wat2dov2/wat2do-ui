import { memo, useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { tracker } from "@/shared/services/trackingService";
import { useTranslation } from "react-i18next";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { EventCardImage } from "@/features/events/components/EventCardImage";
import { useEventStatsActions } from "@/features/events/hooks/useEventStats";
import { useEventsStore } from "@/features/events/store/events.store";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import { useMouseDownAction, useMobileGridClickActivation } from "@/shared/hooks";
import type { Event } from "@/shared/types";
import type { EventStats } from "@/features/events/api/events.api";

interface EventCardProps {
  event: Event;
  /** Live card stats. Omit until the stats query succeeds. */
  stats?: EventStats;
  onEventClick?: (event: Event) => void;
  /** Grid cards: open details on click below the sm breakpoint or on touch. */
  mobileClickActivation?: boolean;
}

function buildEventStatsLabel(
  t: TFunction,
  stats: EventStats | undefined,
): string | undefined {
  if (!stats) return undefined;

  const parts = [
    stats.click_count > 0 ? t("events.clickCount", { count: stats.click_count }) : null,
    stats.going_count > 0 ? t("events.goingCount", { count: stats.going_count }) : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

const CARD_ACTIVATE_IGNORE_SELECTOR =
  "button, a, [role='menuitem'], input, textarea, select, [data-no-card-activate]";

interface EventCardBodyProps {
  event: Event;
  date: string;
  time: string;
  badges: ReturnType<typeof useEventBadges>;
  /** Omitted where there are no stats to show, such as the submit-form preview. */
  stats?: EventStats;
  t: TFunction;
}

/** Text half of the grid card, shared with the submit form's live preview. */
export function EventCardBody({
  event,
  date,
  time,
  badges,
  stats,
  t,
}: EventCardBodyProps) {
  return (
    <div
      className={`flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden relative z-20 bg-surface text-foreground border-border`}
    >
      <EventCardContent
        title={event.title}
        date={date}
        time={time}
        location={event.location}
        badges={badges}
        statsLabel={buildEventStatsLabel(t, stats)}
        textClassName="text-foreground"
        secondaryTextClassName="text-muted-foreground"
        badgeClassName="border-border text-muted-foreground"
      />
    </div>
  );
}

interface UseEventCardNavigationOptions {
  event: Event;
  onEventClick?: (event: Event) => void;
  onIncrementClickCount: (eventId: number) => void;
}

function useEventCardNavigation({
  event,
  onEventClick,
  onIncrementClickCount,
}: UseEventCardNavigationOptions) {
  const handleCardActivate = useCallback(() => {
    onIncrementClickCount(event.id);
    tracker.track(event.id, "click");
    onEventClick?.(event);
  }, [event, onEventClick, onIncrementClickCount]);

  return {
    handleCardActivate,
  };
}

function EventCardComponent({
  event,
  stats,
  onEventClick,
  mobileClickActivation = true,
}: EventCardProps) {
  const [isHoveringBadge, setIsHoveringBadge] = useState(false);

  const { t, i18n } = useTranslation();

  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const { incrementClickCount } = useEventStatsActions(schoolFilter);

  const badges = useEventBadges(event);

  const cardDate = useMemo(
    () => formatCardDate(event, i18n.language || "en-US"),
    [event, i18n.language],
  );
  const cardTime = useMemo(() => formatCardTime(event), [event]);

  const { handleCardActivate } = useEventCardNavigation({
    event,
    onEventClick,
    onIncrementClickCount: incrementClickCount,
  });

  const mobileGridClickActivation = useMobileGridClickActivation();
  const preferClickPress = mobileClickActivation && mobileGridClickActivation;

  const runMouseDownActivate = useMouseDownAction(handleCardActivate);

  const handleCardMouseDown = useCallback(
    (mouseEvent: React.MouseEvent<HTMLElement>) => {
      if (preferClickPress) {
        return;
      }
      runMouseDownActivate(mouseEvent);
    },
    [preferClickPress, runMouseDownActivate],
  );

  const handleCardClick = useCallback(
    (mouseEvent: React.MouseEvent<HTMLElement>) => {
      if (preferClickPress) {
        if (mouseEvent.button !== 0) return;
        if (!(mouseEvent.target instanceof Element)) return;
        if (mouseEvent.target.closest(CARD_ACTIVATE_IGNORE_SELECTOR)) return;
        handleCardActivate();
        return;
      }
      mouseEvent.preventDefault();
    },
    [handleCardActivate, preferClickPress],
  );

  return (
    <article
      data-event-card
      data-event-id={event.id}
      role="button"
      tabIndex={0}
      aria-label={`Event: ${event.title}`}
      onMouseDown={handleCardMouseDown}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardActivate();
        }
      }}
      className={`rounded-xl cursor-pointer transition-all duration-300 group flex flex-col h-full ${
        isHoveringBadge ? "" : "hover:opacity-90 hover:shadow-lg"
      }`}
    >
      <EventCardImage
        event={event}
        variant="card"
        onBadgeHoverChange={setIsHoveringBadge}
      />

      <EventCardBody
        event={event}
        date={cardDate}
        time={cardTime}
        badges={badges}
        stats={stats}
        t={t}
      />
    </article>
  );
}

export const EventCard = memo(EventCardComponent);
EventCard.displayName = "EventCard";
