import { lazy, memo, Suspense, useCallback, useMemo, useState } from "react";
import { Menu as MenuIcon } from "lucide-react";
import { tracker } from "@/shared/services/trackingService";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Download,
  Heart,
  ImageOff,
  MoreHorizontal,
  Share2,
  Flag,
  Trash2,
} from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { Badge } from "@/shared/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { AppleIcon, GoogleIcon } from "@/shared/ui/platform-icons";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { getUserId } from "@/features/auth/api/auth.api";
import { useProfileCompleted, useIsAdmin } from "@/features/auth/hooks/useAuthState";
import { downloadICS, openGoogleCalendar } from "@/shared/utils/generateICS";
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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
  
  // Check if this event should be shown in modal based on URL
  const eventIdParam = searchParams.get(QP.EVENT_ID);
  const showDetailsModal = !disableModal && eventIdParam === event.id.toString();

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

  const filterUrlActions = useFilterUrlActions();

  const handleCategoryClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    filterUrlActions.toggleFilterValue("categories", eventCategory);
    if (window.location.pathname !== "/") {
      navigate("/");
    }
  }, [eventCategory, filterUrlActions, navigate]);

  const handleOrganizationMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (event.organization) {
      filterUrlActions.toggleFilterValue("organizations", event.organization);
      if (window.location.pathname !== "/") {
        navigate("/");
      }
    }
  }, [event.organization, filterUrlActions, navigate]);

  const handleCardActivate = useCallback(() => {
    tracker.track(event.id, "click");
    if (onEventClick) {
      onEventClick(event);
    } else if (!disableModal) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set(QP.EVENT_ID, event.id.toString());
      navigate(`/?${newParams.toString()}`, { replace: false });
    }
  }, [disableModal, event, navigate, onEventClick, searchParams]);

  const handleActionDialogOpen = useCallback(
    (dialog: EventCardDialog) => {
      setIsMenuOpen(false);
      onActionDialogOpen(dialog, event);
    },
    [event, onActionDialogOpen],
  );

  const saveButton = (
    <button
      type="button"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (profileCompleted) toggleSaveEvent(event.id);
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
      <Heart className={`size-4 ${isSaveActive ? "fill-error text-error" : ""}`} fill={isSaveActive ? "currentColor" : "none"} />
    </button>
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
        onMouseDown={handleCardActivate}
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
        {/* Event Image */}
        <div className="relative overflow-hidden" style={{ height: EVENT_CARD_IMAGE_HEIGHT }}>
          {/* Background - lazy loaded image with fallback */}
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
          {/* Category Badge - Top Left (Pastel styling) */}
          <BadgeMask variant="top-left">
            <button
              type="button"
              onMouseDown={handleCategoryClick}
              {...badgeHoverProps}
              className={`font-bold text-[10px] px-2 py-0.5 block rounded-full transition-[background-color,opacity] opacity-70 hover:opacity-100 active:scale-95 ${categoryClasses.bg} ${categoryClasses.text}`}
            >
              {translateCategory(eventCategory, t)}
            </button>
          </BadgeMask>

          {/* Status Badge - Top Right */}
          {(isLive || isNew) && (
            <BadgeMask variant="top-right">
              <Badge variant={isLive ? "live" : "new"} className="uppercase">
                {isLive ? t("common.live") : t("events.new")}
              </Badge>
            </BadgeMask>
          )}

          {/* Manager Menu Badge - Bottom Right */}
          {canManageEvent && onDelete && (
            <BadgeMask variant="bottom-right">
              <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("events.actions")}
                    {...badgeHoverProps}
                    className="event-card-actions-trigger flex items-center justify-center rounded-full border border-foreground/20 bg-background/95 px-2 py-0.5 text-[10px] font-bold text-foreground opacity-90 shadow-sm transition-[background-color,opacity] hover:bg-background hover:opacity-100 data-[state=open]:opacity-100"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-48"
                  align="end"
                  side="top"
                  sideOffset={8}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      handleActionDialogOpen("delete");
                    }}
                  >
                    <Trash2 />
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </BadgeMask>
          )}

          {/* Club/Organization Badge - Bottom Left */}
          {event.organization && (
            <BadgeMask variant="bottom-left">
              <button
                type="button"
                onMouseDown={handleOrganizationMouseDown}
                {...badgeHoverProps}
                className="text-[10px] tracking-normal px-1.5 py-px rounded-full bg-background border border-foreground text-foreground flex items-center transition-[background-color,opacity] opacity-70 hover:bg-muted/20 hover:opacity-100 active:scale-95 cursor-pointer"
              >
                <span className="font-bold truncate max-w-[128px]">
                  {event.organization}
                </span>
              </button>
            </BadgeMask>
          )}
        </div>

        {/* Bottom section: bordered on left/right/bottom, wrapping content + interest button */}
        <div
          className={`event-card-waterpaint flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden ${categoryClasses.bg} ${categoryClasses.text} ${categoryClasses.border}`}
          style={getEventCardWaterpaintStyle(event.id)}
        >
          {/* Event Content */}
          <EventCardContent
            title={event.title}
            date={cardDate}
            time={cardTime}
            location={event.location}
            badges={badges}
            textClassName={categoryClasses.text}
            secondaryTextClassName={categoryClasses.text}
            badgeClassName={`border-current ${categoryClasses.text}`}
          />

          <div className={`grid grid-cols-3 border-t ${categoryClasses.border}`}>
            {profileCompleted ? (
              saveButton
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block min-h-10 cursor-not-allowed" onMouseDown={(e) => e.stopPropagation()}>
                    {saveButton}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("events.saveRequiresLogin")}</p>
                </TooltipContent>
              </Tooltip>
            )}

            <button
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleActionDialogOpen("share");
              }}
              aria-label={t("common.share")}
              className={`flex min-h-10 items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
            >
              <Share2 className="size-4" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={t("common.actions")}
                  className={`flex min-h-10 items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
                >
                  <MenuIcon className="size-4" strokeWidth={2.25} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-48"
                align="end"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem onSelect={() => handleActionDialogOpen("report")}>
                  <Flag />
                  {t("common.report")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Download />
                    {t("common.download")}
                    <ChevronRight className="ml-auto" />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className="w-44"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItem onSelect={() => openGoogleCalendar(event)}>
                      <GoogleIcon className="size-3.5 shrink-0" />
                      {t("events.calendar.googleCalendar")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => downloadICS(event)}>
                      <AppleIcon className="size-3.5 shrink-0" />
                      {t("events.calendar.iCal")}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </article>

      {/* Event Details Modal */}
      {showDetailsModal && (
        <Suspense fallback={null}>
          <EventDetailsModal
            event={event}
            onClose={() => {
              const newParams = new URLSearchParams(searchParams);
              newParams.delete(QP.EVENT_ID);
              navigate(newParams.toString() ? `/?${newParams.toString()}` : "/", { replace: false });
            }}
          />
        </Suspense>
      )}

    </>
  );
}

export const EventCard = memo(EventCardComponent);
EventCard.displayName = "EventCard";
