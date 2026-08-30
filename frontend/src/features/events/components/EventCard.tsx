import { memo, useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { tracker } from "@/shared/services/trackingService";
import { useTranslation } from "react-i18next";
import {
  EventCardContent,
  EventCardContentFrame,
} from "@/shared/ui/event-card-content";
import { EventCardImage } from "@/features/events/components/EventCardImage";
import { useEventStatsActions } from "@/features/events/hooks/useEventStats";
import { useEventsStore } from "@/features/events/store/events.store";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import { useMouseDownAction, useMobileGridClickActivation } from "@/shared/hooks";
import { cn } from "@/shared/lib/utils";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import type { Event } from "@/shared/types";
import type { EventStats } from "@/features/events/api/events.api";

interface EventCardProps {
  event: Event;
  /** Live card stats. Omit until the stats query succeeds. */
  stats?: EventStats;
  onEventClick?: (event: Event) => void;
  /** Grid cards: open details on click below the sm breakpoint or on touch. */
  mobileClickActivation?: boolean;
  /**
   * Renders the card inert: no navigation, no click tracking, no badge menu.
   * Preview surfaces - the submit form's live preview, the Instagram carousel
   * editor - show the card an event will appear as, and nothing more.
   */
  interactive?: boolean;
  /** Crawlable detail destination for surfaces that intentionally render a link. */
  titleHref?: string;
  /** Load this card's poster immediately because it can be an initial LCP candidate. */
  imagePriority?: boolean;
  className?: string;
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
  titleHref?: string;
}

/** Text half of the grid card. */
function EventCardBody({
  event,
  date,
  time,
  badges,
  stats,
  t,
  titleHref,
}: EventCardBodyProps) {
  return (
    <EventCardContentFrame>
      <EventCardContent
        title={event.title}
        titleHref={titleHref}
        date={date}
        time={time}
        location={event.location}
        badges={badges}
        statsLabel={buildEventStatsLabel(t, stats)}
        textClassName="text-foreground"
        secondaryTextClassName="text-muted-foreground"
        badgeClassName="border-border text-muted-foreground"
      />
    </EventCardContentFrame>
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
  interactive = true,
  titleHref = interactive ? eventPagePath(event.id) : undefined,
  imagePriority = false,
  className,
}: EventCardProps) {
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
      if (
        mouseEvent.target instanceof Element &&
        mouseEvent.target.closest("a")
      ) {
        return;
      }
      mouseEvent.preventDefault();
    },
    [handleCardActivate, preferClickPress],
  );

  const activationProps = interactive
    ? {
        "data-event-card": true,
        "data-event-id": event.id,
        role: "button",
        tabIndex: 0,
        "aria-label": `Event: ${event.title}`,
        onMouseDown: handleCardMouseDown,
        onClick: handleCardClick,
        onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardActivate();
          }
        },
      }
    : {};

  return (
    <article
      {...activationProps}
      className={cn(
        "flex w-full flex-col rounded-xl",
        // Grid cards fill their cell so a row shares one height; a preview card
        // stands alone and sits at its natural height.
        interactive && "h-full group cursor-pointer transition-all duration-300",
        interactive && "hover:shadow-lg",
        className,
      )}
    >
      <EventCardImage
        event={event}
        variant="card"
        interactive={interactive}
        priority={imagePriority}
      />

      <EventCardBody
        event={event}
        date={cardDate}
        time={cardTime}
        badges={badges}
        stats={stats}
        t={t}
        titleHref={titleHref}
      />
    </article>
  );
}

export const EventCard = memo(EventCardComponent);
EventCard.displayName = "EventCard";
