import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { memo, useCallback } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  EventCardContent,
  EventCardContentFrame,
} from "@/shared/ui/event-card-content";
import { EventCardImage } from "@/features/events/components/EventCardImage";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import { usePrefetchEventOnPress } from "@/features/events/hooks/usePrefetchEventOnPress";
import { useCardMouseDownActivate, useMobileClickActivation } from "@/shared/hooks";
import { cn } from "@/shared/lib/utils";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { buildEventStatsLabel } from "@/features/events/lib/eventStatsLabel";
import type { Event } from "@/shared/types";
import type { EventStats } from "@/features/events/api/events.api";

interface EventCardProps {
  event: Event;
  /** Live card stats. Omit until the stats query succeeds. */
  stats?: EventStats;
  onEventClick?: (event: Event) => void;
  /**
   * Renders the card inert: no navigation, badge menu or badge tooltips.
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

interface EventCardBodyProps {
  event: Event;
  date: string;
  time: string;
  badges: ReturnType<typeof useEventBadges>;
  /** Omitted where there are no stats to show, such as the submit-form preview. */
  stats?: EventStats;
  t: TFunction;
  titleHref?: string;
  interactive: boolean;
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
  interactive,
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
        interactive={interactive}
        statsLabel={buildEventStatsLabel(t, stats)}
        reserveTitleLines
        reserveStatsLine
        textClassName="text-foreground"
        secondaryTextClassName="text-muted-foreground"
        badgeClassName="border-border text-muted-foreground"
      />
    </EventCardContentFrame>
  );
}

function EventCardComponent({
  event,
  stats,
  onEventClick,
  interactive = true,
  titleHref = interactive ? eventPagePath(event.id) : undefined,
  imagePriority = false,
  className,
}: EventCardProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();

  const badges = useEventBadges(event);

  const cardDate = formatCardDate(event, getSchoolTimezone(event.school), i18n.language || "en-US");
  const cardTime = formatCardTime(event, getSchoolTimezone(event.school), i18n.language);

  const handleCardActivate = useCallback(() => onEventClick?.(event), [event, onEventClick]);
  const pressPrefetch = usePrefetchEventOnPress(event.id);

  const preferClickPress = useMobileClickActivation();

  const runMouseDownActivate = useCardMouseDownActivate(handleCardActivate);

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
        runMouseDownActivate(mouseEvent);
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
    [runMouseDownActivate, preferClickPress],
  );

  const activationProps = interactive
    ? {
        "data-event-card": true,
        "data-event-id": event.id,
        role: "button",
        tabIndex: 0,
        "aria-label": `Event: ${event.title}`,
        ...pressPrefetch,
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
      data-skeleton-key="card"
      {...activationProps}
      className={cn(
        "flex w-full flex-col rounded-xl",
        // Grid cards fill their cell so a row shares one height; a preview card
        // stands alone and sits at its natural height.
        interactive && "h-full group cursor-pointer transition-shadow duration-300",
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
        interactive={interactive}
      />
    </article>
  );
}

export const EventCard = memo(EventCardComponent);
EventCard.displayName = "EventCard";
