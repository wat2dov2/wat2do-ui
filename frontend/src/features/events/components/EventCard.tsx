import { memo, useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { tracker } from "@/shared/services/trackingService";
import { useTranslation } from "react-i18next";
import { ImageOff } from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { EventImageCutout, useEventImageCutouts } from "@/shared/ui/event-image-cutout";
import { Badge } from "@/shared/ui/badge";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { OrganizationBadgeDropdown } from "@/features/organizations";
import { useEventStatsActions } from "@/features/events/hooks/useEventStats";
import { useEventsStore } from "@/features/events/store/events.store";
import { getEventCategory } from "@/shared/utils/event";
import { OrganizationTypeBadge } from "@/shared/components/OrganizationTypeBadge";
import {
  formatCardDate,
  formatCardTime,
  isEventHappeningNow,
  wasAddedWithinLast24Hours,
} from "@/shared/utils/date";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import { useMouseDownAction, useMobileGridClickActivation } from "@/shared/hooks";
import type { Event } from "@/shared/types";
import type { EventStats } from "@/features/events/api/events.api";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

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

interface EventImageBadgesProps {
  event: Event;
  eventCategory: string;
  isLive: boolean;
  isNew: boolean;
  badgeHoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  registerCorner: ReturnType<typeof useEventImageCutouts>["registerCorner"];
  t: TFunction;
}

function EventImageBadges({
  event,
  eventCategory,
  isLive,
  isNew,
  badgeHoverProps,
  registerCorner,
  t,
}: EventImageBadgesProps) {

  return (
    <>
      <BadgeMask variant="top-left" cutout containerRef={registerCorner("top-left")}>
        <OrganizationTypeBadge type={eventCategory} className="opacity-90" />
      </BadgeMask>

      {isLive && (
        <BadgeMask variant="top-right" cutout containerRef={registerCorner("top-right")}>
          <Badge variant="live" size="md" className="flex items-center">
            {t("common.live")}
          </Badge>
        </BadgeMask>
      )}

      {isNew && (
        <BadgeMask variant="bottom-right" cutout containerRef={registerCorner("bottom-right")}>
          <Badge variant="new" size="md" className="flex items-center">
            {t("events.new")}
          </Badge>
        </BadgeMask>
      )}

      {event.organization && (
        <BadgeMask variant="bottom-left" cutout containerRef={registerCorner("bottom-left")}>
          <OrganizationBadgeDropdown
            organizationName={event.organization}
            associationAffiliated={event.association_affiliated}
            school={event.school}
            organizationPage={event.organization_page}
            organizationIg={event.organization_ig}
            organizationDiscord={event.organization_discord}
            badgeHoverProps={badgeHoverProps}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        </BadgeMask>
      )}
    </>
  );
}

interface EventCardImageProps {
  event: Event;
  eventCategory: string;
  isLive: boolean;
  isNew: boolean;
  badgeHoverProps: EventImageBadgesProps["badgeHoverProps"];
  t: TFunction;
}

function EventCardImage({
  event,
  eventCategory,
  isLive,
  isNew,
  badgeHoverProps,
  t,
}: EventCardImageProps) {
  const { surfaceRef, registerCorner: register, cutouts, box } = useEventImageCutouts();

  return (
    <div
      ref={surfaceRef}
      className="relative shrink-0 overflow-hidden rounded-t-xl"
      style={{ height: EVENT_CARD_IMAGE_HEIGHT }}
    >
      {/* Masked face: notches are real holes, so the page backdrop shows through. */}
      <EventImageCutout
        backgroundColor="var(--surface-elevated)"
        imageSrc={event.source_image_url}
        imageAlt={event.title}
        cutouts={cutouts}
        width={box.width}
        height={box.height}
        className="absolute inset-0"
      >
        {!event.source_image_url && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageOff className="size-8 text-muted-foreground opacity-60" />
          </div>
        )}
      </EventImageCutout>
      <EventImageBadges
        event={event}
        eventCategory={eventCategory}
        isLive={isLive}
        isNew={isNew}
        badgeHoverProps={badgeHoverProps}
        registerCorner={register}
        t={t}
      />
    </div>
  );
}

interface EventCardBodyProps {
  event: Event;
  date: string;
  time: string;
  badges: ReturnType<typeof useEventBadges>;
  stats: EventStats | undefined;
  t: TFunction;
}

function EventCardBody({
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

  const handleBadgeMouseEnter = useCallback(() => setIsHoveringBadge(true), []);
  const handleBadgeMouseLeave = useCallback(() => setIsHoveringBadge(false), []);
  const badgeHoverProps = useMemo(
    () => ({
      onMouseEnter: handleBadgeMouseEnter,
      onMouseLeave: handleBadgeMouseLeave,
    }),
    [handleBadgeMouseEnter, handleBadgeMouseLeave],
  );

  const { t, i18n } = useTranslation();

  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const { incrementClickCount } = useEventStatsActions(schoolFilter);

  const badges = useEventBadges(event);
  const eventCategory = useMemo(() => getEventCategory(event), [event]);

  const cardDate = useMemo(
    () => formatCardDate(event, i18n.language || "en-US"),
    [event, i18n.language],
  );
  const cardTime = useMemo(() => formatCardTime(event), [event]);
  const isLive = useMemo(() => isEventHappeningNow(event), [event]);
  const isNew = useMemo(
    () => wasAddedWithinLast24Hours(event),
    [event],
  );

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
        eventCategory={eventCategory}
        isLive={isLive}
        isNew={isNew}
        badgeHoverProps={badgeHoverProps}
        t={t}
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
