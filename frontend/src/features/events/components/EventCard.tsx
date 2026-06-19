import { lazy, Suspense, useState } from "react";
import { tracker } from "@/shared/services/trackingService";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Download,
  Heart,
  ImageOff,
  MoreHorizontal,
  Share2,
  Flag,
  Trash2,
} from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { AppleIcon, GoogleIcon } from "@/shared/ui/platform-icons";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { getUserId } from "@/features/auth/api/auth.api";
import { useProfileCompleted, useIsAdmin } from "@/features/auth/hooks/useAuthState";
import { downloadICS, openGoogleCalendar } from "@/shared/utils/generateICS";
import { translateCategory, getCategoryClasses, getEventCategory } from "@/shared/utils/event";
import { getEventCardWaterpaintStyle } from "@/shared/utils/eventCardWaterpaint";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
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

interface EventCardProps {
  event: Event;
  isSaved?: boolean;
  onEventClick?: (event: Event) => void;
  disableModal?: boolean;
  /** Called when the user confirms deletion (shown only to owners/admins). */
  onDelete?: (eventId: number) => void;
}

type EventCardDialog = "delete" | "share" | "report";

/**
 * Data flow:
 * 1. Explicit props (onEventClick, disableModal, onDelete) come from the
 *    page-level container (EventsPageContainer) via EventList.
 * 2. Stores supply global data:
 *    - `useSavedEventsStore` for the save/unsave action.
 * 3. Narrow auth-slice hooks supply `isAdmin`, `profileCompleted`, and
 *    `getUserId()` the current user identity.
 */
export function EventCard({
  event,
  isSaved = false,
  onEventClick,
  disableModal,
  onDelete,
}: EventCardProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeDialog, setActiveDialog] = useState<EventCardDialog | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHoveringBadge, setIsHoveringBadge] = useState(false);

  const badgeHoverProps = {
    onMouseEnter: () => setIsHoveringBadge(true),
    onMouseLeave: () => setIsHoveringBadge(false),
  };

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
  const eventCategory = getEventCategory(event);
  const categoryClasses = getCategoryClasses(eventCategory);

  // Format date and time using extracted utilities
  const cardDate = formatCardDate(event, i18n.language || 'en-US');
  const cardTime = formatCardTime(event);

  const filterUrlActions = useFilterUrlActions();

  const handleCategoryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    filterUrlActions.toggleFilterValue("categories", eventCategory);
    if (window.location.pathname !== "/") {
      navigate("/");
    }
  };

  const handleOrganizationMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (event.organization) {
      filterUrlActions.toggleFilterValue("organizations", event.organization);
      if (window.location.pathname !== "/") {
        navigate("/");
      }
    }
  };

  const handleCardActivate = () => {
    tracker.track(event.id, "click");
    if (onEventClick) {
      onEventClick(event);
    } else if (!disableModal) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set(QP.EVENT_ID, event.id.toString());
      navigate(`/?${newParams.toString()}`, { replace: false });
    }
  };

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

          {/* Menu Badge - Top Right */}
          <BadgeMask variant="top-right">
            <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("events.actions")}
                  {...badgeHoverProps}
                  className="event-card-actions-trigger flex items-center justify-center rounded-full border border-foreground/20 bg-background/95 px-2 py-0.5 text-[10px] font-bold text-foreground opacity-90 shadow-sm transition-[background-color,opacity] hover:bg-background hover:opacity-100 data-[state=open]:opacity-100"
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-48"
                align="end"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setIsMenuOpen(false);
                    setActiveDialog("report");
                  }}
                >
                  <Flag />
                  {t("common.report")}
                </DropdownMenuItem>
                {canManageEvent && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(e) => {
                        e.preventDefault();
                        setIsMenuOpen(false);
                        setActiveDialog("delete");
                      }}
                    >
                      <Trash2 />
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </BadgeMask>

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
            <button
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                if (profileCompleted) toggleSaveEvent(event.id);
              }}
              disabled={!profileCompleted}
              className={`flex min-h-10 items-center justify-center gap-1.5 px-2 text-xs font-medium transition-colors ${
                !profileCompleted
                  ? "cursor-not-allowed bg-background/25 text-muted-foreground opacity-55 saturate-0"
                  : isSaveActive
                  ? `bg-transparent ${categoryClasses.text} hover:bg-background/40`
                  : `bg-transparent ${categoryClasses.text} opacity-75 hover:bg-background/40 hover:opacity-100`
              }`}
            >
              <Heart className={`size-4 ${isSaveActive ? "fill-error text-error" : ""}`} fill={isSaveActive ? "currentColor" : "none"} />
              <span className="truncate">{isSaveActive ? t("common.saved") : t("common.imInterested")}</span>
            </button>

            <button
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                setActiveDialog("share");
              }}
              className={`flex min-h-10 items-center justify-center gap-1.5 border-l px-2 text-xs font-medium opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
            >
              <Share2 className="size-4" />
              <span className="truncate">{t("common.share")}</span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`flex min-h-10 items-center justify-center gap-1.5 border-l px-2 text-xs font-medium opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
                >
                  <Download className="size-4" />
                  <span className="truncate">{t("common.export")}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-44"
                align="end"
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

      {activeDialog === "delete" && (
        <Suspense fallback={null}>
          <DeleteEventDialog
            open
            onOpenChange={(open) => setActiveDialog(open ? "delete" : null)}
            eventTitle={event.title}
            onConfirm={() => onDelete?.(event.id)}
          />
        </Suspense>
      )}

      {activeDialog === "share" && (
        <Suspense fallback={null}>
          <EventShareDialog
            event={event}
            open
            onOpenChange={(open) => setActiveDialog(open ? "share" : null)}
          />
        </Suspense>
      )}

      {activeDialog === "report" && (
        <Suspense fallback={null}>
          <EventReportDialog
            eventId={event.id}
            eventTitle={event.title}
            open
            onOpenChange={(open) => setActiveDialog(open ? "report" : null)}
          />
        </Suspense>
      )}
    </>
  );
}
