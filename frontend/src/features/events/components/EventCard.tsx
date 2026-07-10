import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { tracker } from "@/shared/services/trackingService";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  Calendar,
  ImageOff,
  MoreHorizontal,
} from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { Badge } from "@/shared/ui/badge";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { EventCalendarDownloadMenu } from "@/features/events/components/EventCalendarDownloadMenu";
import { EventOverflowMenu } from "@/features/events/components/EventOverflowMenu";
import { OrganizationBadgeDropdown } from "@/features/organizations";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { getUserId } from "@/features/auth/api/auth.api";
import { useProfileCompleted, useIsAdmin } from "@/features/auth/hooks/useAuthState";
import { translateCategory, getCategoryClasses, getEventCategory } from "@/shared/utils/event";
import {
  formatCardDate,
  formatCardTime,
  isEventHappeningNow,
  wasAddedWithinLast24Hours,
} from "@/shared/utils/date";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import { useViewTracking } from "@/features/events/hooks/useViewTracking";
import { useMouseDownAction, createAdaptivePressHandlers, useMobileGridClickActivation } from "@/shared/hooks";
import type { Event } from "@/shared/types";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

interface EventCardProps {
  event: Event;
  isSaved?: boolean;
  onEventClick?: (event: Event) => void;
  /** Grid cards: open footer actions on click below the sm breakpoint or on touch. */
  mobileClickActivation?: boolean;
  /** Called when the user confirms deletion (shown only to owners/admins). */
  onDelete?: (eventId: number) => void;
  onActionDialogOpen: (dialog: EventCardDialog, event: Event) => void;
}

export type EventCardDialog = "delete" | "share" | "report";

const CARD_ACTIVATE_IGNORE_SELECTOR =
  "button, a, [role='menuitem'], input, textarea, select, [data-no-card-activate], [data-event-card-footer]";

type CategoryClasses = ReturnType<typeof getCategoryClasses>;

interface EventImageBadgesProps {
  event: Event;
  eventCategory: string;
  categoryClasses: CategoryClasses;
  isLive: boolean;
  isNew: boolean;
  badgeHoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  t: TFunction;
}

function EventImageBadges({
  event,
  eventCategory,
  categoryClasses,
  isLive,
  isNew,
  badgeHoverProps,
  t,
}: EventImageBadgesProps) {
  return (
    <>
      <BadgeMask variant="top-left">
        <Badge
          asChild
          variant="outline"
          size="md"
          className={`block border-0 opacity-70 ${categoryClasses.bg} ${categoryClasses.text}`}
        >
          <span>{translateCategory(eventCategory, t)}</span>
        </Badge>
      </BadgeMask>

      {isLive && (
        <BadgeMask variant="top-right">
          <Badge variant="live" size="md" className="uppercase flex items-center">
            {t("common.live")}
          </Badge>
        </BadgeMask>
      )}

      {isNew && (
        <BadgeMask variant="bottom-right">
          <Badge variant="new" size="md" className="uppercase flex items-center">
            {t("events.new")}
          </Badge>
        </BadgeMask>
      )}

      {event.organization && (
        <BadgeMask variant="bottom-left">
          <OrganizationBadgeDropdown
            organizationName={event.organization}
            organizationType={event.organization_type}
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

interface EventFooterActionsProps {
  event: Event;
  saveButton: ReactNode;
  profileCompleted: boolean;
  categoryClasses: CategoryClasses;
  canDelete: boolean;
  preferClickPress: boolean;
  onActionDialogOpen: (dialog: EventCardDialog) => void;
  t: TFunction;
}

function EventFooterActions({
  event,
  saveButton,
  profileCompleted,
  categoryClasses,
  canDelete,
  preferClickPress,
  onActionDialogOpen,
  t,
}: EventFooterActionsProps) {

  return (
    <div
      data-event-card-footer
      onMouseDown={preferClickPress ? undefined : (event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className={`grid grid-cols-3 border-t ${categoryClasses.border}`}
    >
      {profileCompleted ? (
        saveButton
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block min-h-10 cursor-not-allowed" onClick={(e) => e.stopPropagation()}>
              {saveButton}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t("events.saveRequiresLogin")}</p>
          </TooltipContent>
        </Tooltip>
      )}

      <EventCalendarDownloadMenu
        event={event}
        stopPropagation
        triggerTooltip={t("common.addToCalendar")}
      >
        <button
          type="button"
          aria-label={t("common.addToCalendar")}
          className={`flex min-h-10 w-full items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
        >
          <Calendar className="size-4" />
        </button>
      </EventCalendarDownloadMenu>

      <EventOverflowMenu
        canDelete={canDelete}
        onAction={onActionDialogOpen}
        stopPropagation
        triggerTooltip={t("common.moreOptions")}
      >
        <button
          type="button"
          aria-label={t("common.moreOptions")}
          className={`flex min-h-10 w-full items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </EventOverflowMenu>
    </div>
  );
}

interface SaveEventButtonProps {
  eventId: number;
  profileCompleted: boolean;
  isSaveActive: boolean;
  categoryClasses: CategoryClasses;
  preferClickPress: boolean;
  onToggleSaveEvent: (eventId: number) => void;
  t: TFunction;
}

function SaveEventButton({
  eventId,
  profileCompleted,
  isSaveActive,
  categoryClasses,
  preferClickPress,
  onToggleSaveEvent,
  t,
}: SaveEventButtonProps) {
  const pressHandlers = createAdaptivePressHandlers({
    preferClick: preferClickPress,
    disabled: !profileCompleted,
    onClick: () => {
      if (profileCompleted) {
        onToggleSaveEvent(eventId);
      }
    },
  });

  return (
    <button
      type="button"
      {...pressHandlers}
      disabled={!profileCompleted}
      aria-label={isSaveActive ? t("common.saved") : t("common.imInterested")}
      title={isSaveActive ? t("common.saved") : t("common.imInterested")}
      className={`flex min-h-10 w-full items-center justify-center px-2 transition-colors ${
        !profileCompleted
          ? `pointer-events-none cursor-not-allowed bg-transparent ${categoryClasses.text} opacity-45 hover:bg-transparent hover:opacity-45`
          : isSaveActive
          ? `bg-transparent ${categoryClasses.text} hover:bg-background/40`
          : `bg-transparent ${categoryClasses.text} opacity-75 hover:bg-background/40 hover:opacity-100`
      }`}
    >
      <Bookmark
        className={`size-4 ${isSaveActive ? "fill-current" : ""}`}
        fill={isSaveActive ? "currentColor" : "none"}
      />
    </button>
  );
}

interface EventCardImageProps {
  event: Event;
  eventCategory: string;
  categoryClasses: CategoryClasses;
  isLive: boolean;
  isNew: boolean;
  badgeHoverProps: EventImageBadgesProps["badgeHoverProps"];
  t: TFunction;
}

function EventCardImage({
  event,
  eventCategory,
  categoryClasses,
  isLive,
  isNew,
  badgeHoverProps,
  t,
}: EventCardImageProps) {
  return (
    <div className="relative" style={{ height: EVENT_CARD_IMAGE_HEIGHT }}>
      <div className="absolute inset-0 overflow-hidden rounded-t-xl">
        <LazyImage
          src={event.source_image_url ?? undefined}
          alt={event.title}
          className="absolute inset-0 w-full h-full"
          fallback={
            <div
              className={`absolute inset-0 ${categoryClasses.bg} flex items-center justify-center`}
            >
              <ImageOff className={`size-8 ${categoryClasses.text} opacity-40`} />
            </div>
          }
          placeholder={
            <div
              className={`absolute inset-0 ${categoryClasses.bg} animate-pulse`}
            />
          }
        />
      </div>
      <EventImageBadges
        event={event}
        eventCategory={eventCategory}
        categoryClasses={categoryClasses}
        isLive={isLive}
        isNew={isNew}
        badgeHoverProps={badgeHoverProps}
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
  profileCompleted: boolean;
  isSaveActive: boolean;
  categoryClasses: CategoryClasses;
  canDelete: boolean;
  preferClickPress: boolean;
  onToggleSaveEvent: (eventId: number) => void;
  onActionDialogOpen: (dialog: EventCardDialog) => void;
  t: TFunction;
}

function EventCardBody({
  event,
  date,
  time,
  badges,
  profileCompleted,
  isSaveActive,
  categoryClasses,
  canDelete,
  preferClickPress,
  onToggleSaveEvent,
  onActionDialogOpen,
  t,
}: EventCardBodyProps) {
  const saveButton = (
    <SaveEventButton
      eventId={event.id}
      profileCompleted={profileCompleted}
      isSaveActive={isSaveActive}
      categoryClasses={categoryClasses}
      preferClickPress={preferClickPress}
      onToggleSaveEvent={onToggleSaveEvent}
      t={t}
    />
  );

  return (
    <div
      className={`flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden relative z-20 ${categoryClasses.bg} ${categoryClasses.text} ${categoryClasses.border}`}
    >
      <EventCardContent
        title={event.title}
        date={date}
        time={time}
        location={event.location}
        badges={badges}
        textClassName={categoryClasses.text}
        secondaryTextClassName={categoryClasses.text}
        badgeClassName={`border-current ${categoryClasses.text}`}
      />

      <EventFooterActions
        event={event}
        saveButton={saveButton}
        profileCompleted={profileCompleted}
        categoryClasses={categoryClasses}
        canDelete={canDelete}
        preferClickPress={preferClickPress}
        onActionDialogOpen={onActionDialogOpen}
        t={t}
      />
    </div>
  );
}

interface UseEventCardNavigationOptions {
  event: Event;
  onEventClick?: (event: Event) => void;
}

function useEventCardNavigation({
  event,
  onEventClick,
}: UseEventCardNavigationOptions) {
  const handleCardActivate = useCallback(() => {
    tracker.track(event.id, "click");
    onEventClick?.(event);
  }, [event, onEventClick]);

  return {
    handleCardActivate,
  };
}

function EventCardComponent({
  event,
  isSaved = false,
  onEventClick,
  mobileClickActivation = true,
  onDelete,
  onActionDialogOpen,
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

  const profileCompleted = useProfileCompleted();
  const isAdmin = useIsAdmin();
  const currentUserId = getUserId();

  const toggleSaveEvent = useSavedEventsStore((s) => s.toggleSaveEvent);

  const isOwner = Boolean(currentUserId && event.created_by && currentUserId === event.created_by);
  const canManageEvent = isAdmin || isOwner;
  const isSaveActive = profileCompleted && isSaved;
  
  const cardRef = useViewTracking(event.id);

  const badges = useEventBadges(event);
  const eventCategory = useMemo(() => getEventCategory(event), [event]);
  const categoryClasses = useMemo(() => getCategoryClasses(eventCategory), [eventCategory]);

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
  });

  const mobileGridClickActivation = useMobileGridClickActivation();
  const preferClickPress = mobileClickActivation && mobileGridClickActivation;

  const handleActionDialogOpen = useCallback(
    (dialog: EventCardDialog) => {
      onActionDialogOpen(dialog, event);
    },
    [event, onActionDialogOpen],
  );

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
    <>
      <article
        ref={cardRef}
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
        className={`rounded-xl cursor-pointer transition-all duration-300 group flex flex-col h-full bg-card ${
          isHoveringBadge ? "" : "hover:opacity-90 hover:shadow-lg"
        }`}
      >
        <EventCardImage
          event={event}
          eventCategory={eventCategory}
          categoryClasses={categoryClasses}
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
          profileCompleted={profileCompleted}
          isSaveActive={isSaveActive}
          categoryClasses={categoryClasses}
          canDelete={canManageEvent && Boolean(onDelete)}
          preferClickPress={preferClickPress}
          onToggleSaveEvent={toggleSaveEvent}
          onActionDialogOpen={handleActionDialogOpen}
          t={t}
        />
      </article>
    </>
  );
}

export const EventCard = memo(EventCardComponent);
EventCard.displayName = "EventCard";
