import { lazy, memo, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { tracker } from "@/shared/services/trackingService";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Download,
  Heart,
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
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { useEventsStore } from "@/features/events/store/events.store";
import { getUserId } from "@/features/auth/api/auth.api";
import { useProfileCompleted, useIsAdmin } from "@/features/auth/hooks/useAuthState";
import { translateCategory, getCategoryClasses, getEventCategory } from "@/shared/utils/event";
import { getEventCardWaterpaintStyle } from "@/shared/utils/eventCardWaterpaint";
import {
  formatCardDate,
  formatCardTime,
  isEventHappeningNow,
  wasAddedWithinLast24Hours,
} from "@/shared/utils/date";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import { useViewTracking } from "@/features/events/hooks/useViewTracking";
import type { Event } from "@/shared/types";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { QP } from "@/shared/constants/queryParams";
import { useFilterUrlActions } from "@/features/search";

const EventDetailsModal = lazy(() =>
  import("@/features/events/components/EventDetailsModal").then((module) => ({
    default: module.EventDetailsModal,
  })),
);

interface EventCardProps {
  event: Event;
  isSaved?: boolean;
  onEventClick?: (event: Event) => void;
  disableModal?: boolean;
  /** Called when the user confirms deletion (shown only to owners/admins). */
  onDelete?: (eventId: number) => void;
  onActionDialogOpen: (dialog: EventCardDialog, event: Event) => void;
}

export type EventCardDialog = "delete" | "share" | "report";

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
  onCategoryClick: (e: React.MouseEvent) => void;
  onOrganizationMouseDown: (e: React.MouseEvent) => void;
  t: TFunction;
}

function EventImageBadges({
  event,
  eventCategory,
  categoryClasses,
  isLive,
  isNew,
  badgeHoverProps,
  onCategoryClick,
  onOrganizationMouseDown,
  t,
}: EventImageBadgesProps) {
  return (
    <>
      <BadgeMask variant="top-left">
        <button
          type="button"
          onMouseDown={onCategoryClick}
          {...badgeHoverProps}
          className={`font-bold text-[10px] px-2 py-0.5 block rounded-full transition-[background-color,opacity] opacity-70 hover:opacity-100 active:scale-95 ${categoryClasses.bg} ${categoryClasses.text}`}
        >
          {translateCategory(eventCategory, t)}
        </button>
      </BadgeMask>

      {(isLive || isNew) && (
        <BadgeMask variant="top-right">
          <Badge variant={isLive ? "live" : "new"} className="uppercase">
            {isLive ? t("common.live") : t("events.new")}
          </Badge>
        </BadgeMask>
      )}

      {event.organization && (
        <BadgeMask variant="bottom-left">
          <button
            type="button"
            onMouseDown={onOrganizationMouseDown}
            {...badgeHoverProps}
            className="text-[10px] tracking-normal px-1.5 py-px rounded-full bg-background border border-foreground text-foreground flex items-center transition-[background-color,opacity] opacity-70 hover:bg-muted/20 hover:opacity-100 active:scale-95 cursor-pointer"
          >
            <span className="font-bold truncate max-w-[128px]">
              {event.organization}
            </span>
          </button>
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
  onActionDialogOpen: (dialog: EventCardDialog) => void;
  t: TFunction;
}

function EventFooterActions({
  event,
  saveButton,
  profileCompleted,
  categoryClasses,
  canDelete,
  onActionDialogOpen,
  t,
}: EventFooterActionsProps) {
  return (
    <div className={`grid grid-cols-3 border-t ${categoryClasses.border}`}>
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

      <EventCalendarDownloadMenu event={event} stopPropagation>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={t("common.download")}
          className={`flex min-h-10 items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
        >
          <Download className="size-4" />
        </button>
      </EventCalendarDownloadMenu>

      <EventOverflowMenu
        canDelete={canDelete}
        onAction={onActionDialogOpen}
        stopPropagation
      >
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={t("common.actions")}
          className={`flex min-h-10 items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
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
  onToggleSaveEvent: (eventId: number) => void;
  t: TFunction;
}

function SaveEventButton({
  eventId,
  profileCompleted,
  isSaveActive,
  categoryClasses,
  onToggleSaveEvent,
  t,
}: SaveEventButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (profileCompleted) onToggleSaveEvent(eventId);
      }}
      disabled={!profileCompleted}
      aria-label={isSaveActive ? t("common.saved") : t("common.imInterested")}
      className={`flex min-h-10 w-full items-center justify-center px-2 transition-colors ${
        !profileCompleted
          ? `pointer-events-none cursor-not-allowed bg-transparent ${categoryClasses.text} opacity-45 hover:bg-transparent hover:opacity-45`
          : isSaveActive
          ? `bg-transparent ${categoryClasses.text} hover:bg-background/40`
          : `bg-transparent ${categoryClasses.text} opacity-75 hover:bg-background/40 hover:opacity-100`
      }`}
    >
      <Heart
        className={`size-4 ${isSaveActive ? "fill-error text-error" : ""}`}
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
  onCategoryClick: EventImageBadgesProps["onCategoryClick"];
  onOrganizationMouseDown: EventImageBadgesProps["onOrganizationMouseDown"];
  t: TFunction;
}

function EventCardImage({
  event,
  eventCategory,
  categoryClasses,
  isLive,
  isNew,
  badgeHoverProps,
  onCategoryClick,
  onOrganizationMouseDown,
  t,
}: EventCardImageProps) {
  return (
    <div className="relative overflow-hidden" style={{ height: EVENT_CARD_IMAGE_HEIGHT }}>
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
      <EventImageBadges
        event={event}
        eventCategory={eventCategory}
        categoryClasses={categoryClasses}
        isLive={isLive}
        isNew={isNew}
        badgeHoverProps={badgeHoverProps}
        onCategoryClick={onCategoryClick}
        onOrganizationMouseDown={onOrganizationMouseDown}
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
      onToggleSaveEvent={onToggleSaveEvent}
      t={t}
    />
  );

  return (
    <div
      className={`event-card-waterpaint flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden ${categoryClasses.bg} ${categoryClasses.text} ${categoryClasses.border}`}
      style={getEventCardWaterpaintStyle(event.id)}
    >
      <EventCardContent
        title={event.title}
        date={date}
        time={time}
        location={event.location}
        badges={badges}
        clickLabel={t("events.clickCount", { count: event.click_count ?? 0 })}
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
        onActionDialogOpen={onActionDialogOpen}
        t={t}
      />
    </div>
  );
}

interface EventDetailsModalMountProps {
  event: Event;
  open: boolean;
  onClose: () => void;
}

function EventDetailsModalMount({
  event,
  open,
  onClose,
}: EventDetailsModalMountProps) {
  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <EventDetailsModal
        event={event}
        onClose={onClose}
      />
    </Suspense>
  );
}

interface UseEventCardNavigationOptions {
  event: Event;
  eventCategory: string;
  disableModal?: boolean;
  onEventClick?: (event: Event) => void;
}

function useEventCardNavigation({
  event,
  eventCategory,
  disableModal,
  onEventClick,
}: UseEventCardNavigationOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filterUrlActions = useFilterUrlActions();

  const eventIdParam = searchParams.get(QP.EVENT_ID);
  const showDetailsModal = !disableModal && eventIdParam === event.id.toString();

  const handleCategoryClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    filterUrlActions.toggleFilterValue("categories", eventCategory);
    if (pathname !== "/") {
      router.push("/");
    }
  }, [eventCategory, filterUrlActions, pathname, router]);

  const handleOrganizationMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (event.organization) {
      filterUrlActions.toggleFilterValue("organizations", event.organization);
      if (pathname !== "/") {
        router.push("/");
      }
    }
  }, [event.organization, filterUrlActions, pathname, router]);

  const handleCardActivate = useCallback(() => {
    tracker.track(event.id, "click");
    useEventsStore.getState().incrementClickCount(event.id);
    if (onEventClick) {
      onEventClick(event);
    } else if (!disableModal) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set(QP.EVENT_ID, event.id.toString());
      router.push(`/?${newParams.toString()}`);
    }
  }, [disableModal, event, onEventClick, router, searchParams]);

  const handleDetailsModalClose = useCallback(() => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.delete(QP.EVENT_ID);
    router.push(newParams.toString() ? `/?${newParams.toString()}` : "/");
  }, [router, searchParams]);

  return {
    handleCategoryClick,
    handleOrganizationMouseDown,
    handleCardActivate,
    handleDetailsModalClose,
    showDetailsModal,
  };
}

/**
 * Data flow:
 * 1. Explicit props (onEventClick, disableModal, onDelete) come from the
 *    page-level container (EventsPageContainer) via EventList.
 * 2. Stores supply global data:
 *    - `useSavedEventsStore` for the save/unsave action.
 * 3. Narrow auth-slice hooks supply `isAdmin`, `profileCompleted`, and
 *    `getUserId()` the current user identity.
 */
function EventCardComponent({
  event,
  isSaved = false,
  onEventClick,
  disableModal,
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

  // Mutations go through stores directly.
  const toggleSaveEvent = useSavedEventsStore((s) => s.toggleSaveEvent);

  // Show delete only if the user is an admin or the event owner.
  const isOwner = Boolean(currentUserId && event.created_by && currentUserId === event.created_by);
  const canManageEvent = isAdmin || isOwner;
  const isSaveActive = profileCompleted && isSaved;
  
  // Track card visibility (view impression)
  const cardRef = useViewTracking(event.id);

  // Use extracted hook for badges
  const badges = useEventBadges(event);
  const eventCategory = useMemo(() => getEventCategory(event), [event]);
  const categoryClasses = useMemo(() => getCategoryClasses(eventCategory), [eventCategory]);

  // Format date and time using extracted utilities
  const cardDate = useMemo(
    () => formatCardDate(event, i18n.language || "en-US"),
    [event, i18n.language],
  );
  const cardTime = useMemo(() => formatCardTime(event), [event]);
  const isLive = useMemo(() => isEventHappeningNow(event), [event]);
  const isNew = useMemo(
    () => !isLive && wasAddedWithinLast24Hours(event),
    [event, isLive],
  );

  const {
    handleCategoryClick,
    handleOrganizationMouseDown,
    handleCardActivate,
    handleDetailsModalClose,
    showDetailsModal,
  } = useEventCardNavigation({
    event,
    eventCategory,
    disableModal,
    onEventClick,
  });

  const handleActionDialogOpen = useCallback(
    (dialog: EventCardDialog) => {
      onActionDialogOpen(dialog, event);
    },
    [event, onActionDialogOpen],
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
        onClick={handleCardActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardActivate();
          }
        }}
        className={`rounded-xl overflow-hidden cursor-pointer transition-all duration-300 group flex flex-col h-full bg-card ${
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
          onCategoryClick={handleCategoryClick}
          onOrganizationMouseDown={handleOrganizationMouseDown}
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
          onToggleSaveEvent={toggleSaveEvent}
          onActionDialogOpen={handleActionDialogOpen}
          t={t}
        />
      </article>

      <EventDetailsModalMount
        event={event}
        open={showDetailsModal}
        onClose={handleDetailsModalClose}
      />
    </>
  );
}

export const EventCard = memo(EventCardComponent);
EventCard.displayName = "EventCard";
