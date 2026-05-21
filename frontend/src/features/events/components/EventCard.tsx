import { lazy, Suspense, useState } from "react";
import { tracker } from "@/shared/services/trackingService";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Download,
  Heart,
  Sparkles,
  ImageOff,
  MoreHorizontal,
  Share2,
  Flag,
  Trash2,
  CalendarPlus,
} from "lucide-react";
import { BadgeMask } from "@/shared/ui/badge-mask";
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
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { useEventsStore } from "@/features/events/store/events.store";
import { useProfileCompleted, useIsAdmin } from "@/features/auth/hooks/useAuthState";
import { getUserId } from "@/features/auth";
import { downloadICS, openGoogleCalendar } from "@/shared/utils/generateICS";
import { translateCategory, getCategoryClasses, getEventCategory } from "@/shared/utils/event";
import { getEventCardWaterpaintStyle } from "@/shared/utils/eventCardWaterpaint";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import { useViewTracking } from "@/features/events/hooks/useViewTracking";
import type { Event } from "@/shared/types";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { QP } from "@/shared/constants/queryParams";

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
  isPromoted?: boolean;
  onEventClick?: (event: Event) => void;
  disableModal?: boolean;
  /** Called when the user confirms deletion (shown only to owners/admins). */
  onDelete?: (eventId: number) => void;
}

/**
 * Data flow:
 * 1. Explicit props (onEventClick, disableModal, onDelete) come from the
 *    page-level container (EventsPageContainer) via EventList.
 * 2. Stores supply global data:
 *    - `useSavedEventsStore` for the save/unsave action.
 *    - `useEventsStore` for `allEvents` (similar-events grid in modal).
 * 3. Narrow auth-slice hooks supply `isAdmin`, `profileCompleted`, and
 *    `getUserId()` the current user identity.
 */
export function EventCard({
  event,
  isSaved = false,
  isPromoted = false,
  onEventClick,
  disableModal,
  onDelete,
}: EventCardProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { t, i18n } = useTranslation();

  const profileCompleted = useProfileCompleted();
  const isAdmin = useIsAdmin();
  const currentUserId = getUserId();

  // Mutations go through stores directly.
  const toggleSaveEvent = useSavedEventsStore((s) => s.toggleSaveEvent);
  // All events feed the similar-events grid in EventDetailsModal.
  const allEvents = useEventsStore((s) => s.events);

  // Show delete only if the user is an admin or the event owner.
  const isOwner = Boolean(currentUserId && event.created_by && currentUserId === event.created_by);
  const canManageEvent = isAdmin || isOwner;
  
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
        onClick={handleCardActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardActivate();
          }
        }}
        className={`rounded-xl overflow-hidden hover:shadow-lg hover:opacity-80 cursor-pointer transition-all duration-300 group flex flex-col h-full bg-card ${
          isPromoted
            ? "ring-2 ring-amber-400 shadow-amber-100 dark:shadow-amber-900/20 shadow-md"
            : ""
        }`}
      >
        {/* Event Image */}
        <div className="relative overflow-hidden" style={{ height: EVENT_CARD_IMAGE_HEIGHT }}>
          {/* Background - lazy loaded image with fallback */}
          <LazyImage
            src={event.imageUrl || event.source_image_url}
            alt={event.title}
            className="absolute inset-0 w-full h-full"
            fallback={
              <div
                className={`absolute inset-0 ${
                  isPromoted
                    ? "bg-linear-to-br from-yellow-100 to-yellow-50"
                    : categoryClasses.bg
                } flex items-center justify-center`}
              >
                <ImageOff className={`size-8 ${categoryClasses.text} opacity-40`} />
              </div>
            }
            placeholder={
              <div
                className={`absolute inset-0 ${
                  isPromoted
                    ? "bg-linear-to-br from-yellow-100 to-yellow-50"
                    : categoryClasses.bg
                } animate-pulse`}
              />
            }
          />
          {/* Category Badge - Top Left (Pastel styling) */}
          <BadgeMask variant="top-left">
            <span
              className={`font-bold text-[10px] px-2 py-0.5 block rounded-full ${categoryClasses.bg} ${categoryClasses.text}`}
            >
              {translateCategory(eventCategory, t)}
            </span>
          </BadgeMask>

          {/* Promoted Badge - Below Category on left side */}
          {isPromoted && (
            <div className="absolute top-8 left-2 z-10">
              <span className="bg-linear-to-r from-amber-500 to-amber-600 text-white font-bold text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="size-3" />
                {t("events.promoted")}
              </span>
            </div>
          )}

          {/* Menu Badge - Top Right */}
          <BadgeMask variant="top-right">
            <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("events.actions")}
                  className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-secondary text-foreground flex items-center justify-center hover:bg-secondary transition-colors"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-48"
                align="end"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setIsMenuOpen(false);
                    setShowShareDialog(true);
                  }}
                >
                  <Share2 />
                  {t("common.share")}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Download />
                    <span>{t("common.addToCalendar")}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    sideOffset={8}
                    alignOffset={-4}
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        setIsMenuOpen(false);
                        openGoogleCalendar(event);
                      }}
                    >
                      <CalendarPlus />
                      {t("events.calendar.googleCalendar")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setIsMenuOpen(false);
                        downloadICS(event);
                      }}
                    >
                      <Download />
                      {t("events.calendar.iCal")}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setIsMenuOpen(false);
                    setShowReportDialog(true);
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
                        setShowDeleteConfirm(true);
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
          <BadgeMask variant="bottom-left">
            <span className="text-[10px] tracking-normal px-1.5 py-px rounded-full bg-background border border-foreground text-foreground flex items-center">
              <span className="truncate max-w-[128px]">
                {event.organization || event.display_handle || ''}
              </span>
            </span>
          </BadgeMask>
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

          {/* I'm Interested button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (profileCompleted) toggleSaveEvent(event.id);
            }}
            disabled={!profileCompleted}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors border-t ${categoryClasses.border} ${
              isSaved
                ? `bg-transparent ${categoryClasses.text} hover:bg-background/40`
                : `bg-transparent ${categoryClasses.text} opacity-75 hover:bg-background/40 hover:opacity-100`
            } ${!profileCompleted ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <Heart className={`w-4 h-4 ${isSaved ? "fill-error text-error" : ""}`} />
            {isSaved ? t("common.saved") : t("common.imInterested")}
          </button>
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
            allEvents={allEvents}
          />
        </Suspense>
      )}

      {showDeleteConfirm && (
        <Suspense fallback={null}>
          <DeleteEventDialog
            open={showDeleteConfirm}
            onOpenChange={setShowDeleteConfirm}
            eventTitle={event.title}
            onConfirm={() => onDelete?.(event.id)}
          />
        </Suspense>
      )}

      {showShareDialog && (
        <Suspense fallback={null}>
          <EventShareDialog
            event={event}
            open={showShareDialog}
            onOpenChange={setShowShareDialog}
          />
        </Suspense>
      )}

      {showReportDialog && (
        <Suspense fallback={null}>
          <EventReportDialog
            eventId={event.id}
            eventTitle={event.title}
            open={showReportDialog}
            onOpenChange={setShowReportDialog}
          />
        </Suspense>
      )}
    </>
  );
}
