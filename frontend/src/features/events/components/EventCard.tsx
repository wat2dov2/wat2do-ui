import { useState } from "react";
import { tracker } from "@/shared/services/trackingService";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Users,
  Download,
  Heart,
  Sparkles,
  ImageOff,
  MoreHorizontal,
  Share2,
  Flag,
  Trash2,
} from "lucide-react";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";
import { DeleteEventDialog } from "@/features/events/components/DeleteEventDialog";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { useEventsStore } from "@/features/events/store/events.store";
import { useProfileCompleted, useIsAdmin } from "@/features/auth/hooks/useAuthState";
import { getUserId } from "@/features/auth";
import { shareEvent } from "@/shared/utils/shareEvent";
import { translateCategory, getCategoryClasses } from "@/shared/utils/event";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import { useViewTracking } from "@/features/events/hooks/useViewTracking";
import type { Event } from "@/shared/types";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { DEFAULT_EVENT_CATEGORY } from "@/shared/constants/eventCategories";
import { QP } from "@/shared/constants/queryParams";

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
                    : "bg-linear-to-br from-muted to-muted/80"
                } flex items-center justify-center`}
              >
                <ImageOff className="size-8 text-muted-foreground/40" />
              </div>
            }
            placeholder={
              <div
                className={`absolute inset-0 ${
                  isPromoted
                    ? "bg-linear-to-br from-yellow-100 to-yellow-50"
                    : "bg-linear-to-br from-muted to-muted/80"
                } animate-pulse`}
              />
            }
          />
          {/* Category Badge - Top Left (Pastel styling) */}
          <BadgeMask variant="top-left">
            <span
              className={`font-bold text-[10px] px-2 py-0.5 block rounded-full ${
                getCategoryClasses(event.category || DEFAULT_EVENT_CATEGORY).bg
              } ${getCategoryClasses(event.category || DEFAULT_EVENT_CATEGORY).text}`}
            >
              {translateCategory(event.category || DEFAULT_EVENT_CATEGORY, t)}
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
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-secondary text-foreground flex items-center justify-center hover:bg-secondary transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-48 p-1"
                align="end"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-secondary text-foreground transition-colors text-left"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await shareEvent(event);
                      } catch (error) {
                        console.error("Failed to share event:", error);
                      }
                    }}
                  >
                    <Share2 className="size-3.5" />
                    {t("common.share")}
                  </button>
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-secondary text-foreground transition-colors text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Handle add to calendar
                    }}
                  >
                    <Download className="size-3.5" />
                    {t("common.addToCalendar")}
                  </button>
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-secondary text-foreground transition-colors text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Handle report
                    }}
                  >
                    <Flag className="size-3.5" />
                    {t("common.report")}
                  </button>
                  {canManageEvent && (
                    <>
                      <div className="h-px bg-border my-0.5" />
                      <button
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-error/10 text-error transition-colors text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeleteConfirm(true);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        {t("common.delete")}
                      </button>
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </BadgeMask>

          {/* Club/Organization Badge - Bottom Left */}
          <BadgeMask variant="bottom-left">
            <span className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-background border border-foreground text-foreground flex items-center gap-1.5">
              <Users className="size-3" strokeWidth={2} />
              <span className="truncate max-w-[100px]">
                {event.organization || event.display_handle || ''}
              </span>
            </span>
          </BadgeMask>
        </div>

        {/* Bottom section: bordered on left/right/bottom, wrapping content + interest button */}
        <div className="flex flex-col flex-1 border-l border-r border-b border-border rounded-b-xl overflow-hidden">
          {/* Event Content */}
          <EventCardContent
            title={event.title}
            date={cardDate}
            time={cardTime}
            location={event.location}
            badges={badges}
          />

          {/* I'm Interested button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (profileCompleted) toggleSaveEvent(event.id);
            }}
            disabled={!profileCompleted}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors border-t border-border ${
              isSaved
                ? "bg-error/10 text-error hover:bg-error/20"
                : "bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
            } ${!profileCompleted ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <Heart className={`w-4 h-4 ${isSaved ? "fill-error" : ""}`} />
            {isSaved ? t("common.saved") : t("common.imInterested")}
          </button>
        </div>
      </article>

      {/* Event Details Modal */}
      {showDetailsModal && (
        <EventDetailsModal
          event={event}
          onClose={() => {
            const newParams = new URLSearchParams(searchParams);
            newParams.delete(QP.EVENT_ID);
            navigate(newParams.toString() ? `/?${newParams.toString()}` : "/", { replace: false });
          }}
          allEvents={allEvents}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteEventDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        eventTitle={event.title}
        onConfirm={() => onDelete?.(event.id)}
      />
    </>
  );
}
