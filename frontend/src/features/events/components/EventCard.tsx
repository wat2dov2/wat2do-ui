import React, { useState } from "react";
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
  Edit,
  Trash2,
} from "lucide-react";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { LightRays } from "@/shared/ui/light-rays";
import { LazyImage } from "@/shared/ui/lazy-image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";
import { useEventsContextOptional } from "@/features/events/context/EventsContext";
import { shareEvent } from "@/shared/utils/shareEvent";
import { translateCategory, getCategoryClasses } from "@/shared/utils/event";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import type { Event } from "@/shared/types";

interface EventCardProps {
  event: Event;
  isSaved?: boolean;
  isPromoted?: boolean;
  onEventClick?: (event: Event) => void;
  disableModal?: boolean;
}


export const EventCard = React.memo(function EventCard({
  event,
  isSaved = false,
  isPromoted = false,
  onEventClick: propOnEventClick,
  disableModal: propDisableModal,
}: EventCardProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { t, i18n } = useTranslation();
  
  // Get values from context (with prop overrides)
  // Use optional context - returns null when not inside EventsProvider
  const context = useEventsContextOptional();

  // Provide fallback defaults when context is null
  const toggleSaveEvent = context?.toggleSaveEvent ?? (() => {});
  const isAdmin = context?.isAdmin ?? false;
  const onEdit = context?.onEdit;
  const onDelete = context?.onDelete;
  const allEvents = context?.allEvents ?? [];
  const contextOnEventClick = context?.onEventClick;
  const contextDisableModal = context?.disableModal;
  
  // Use prop values if provided, otherwise fall back to context
  const onEventClick = propOnEventClick ?? contextOnEventClick;
  const disableModal = propDisableModal ?? contextDisableModal;
  
  // Check if this event should be shown in modal based on URL
  const eventIdParam = searchParams.get("eventId");
  const showDetailsModal = !disableModal && eventIdParam === event.id.toString();

  // Use extracted hook for badges
  const badges = useEventBadges(event);

  // Format date and time using extracted utilities
  const cardDate = formatCardDate(event, i18n.language || 'en-US');
  const cardTime = formatCardTime(event);

  return (
    <>
      <article
        data-event-card
        data-event-id={event.id}
        role="article"
        aria-label={`Event: ${event.title}`}
        onClick={() => {
          if (onEventClick) {
            onEventClick(event);
          } else if (!disableModal) {
            const newParams = new URLSearchParams(searchParams);
            newParams.set("eventId", event.id.toString());
            navigate(`/?${newParams.toString()}`, { replace: false });
          }
        }}
        className={`rounded-xl overflow-hidden hover:shadow-lg hover:opacity-80 cursor-pointer transition-all duration-300 group flex flex-col h-full bg-card ${
          isPromoted
            ? "ring-2 ring-amber-400 shadow-amber-100 dark:shadow-amber-900/20 shadow-md"
            : ""
        }`}
      >
        {/* Event Image */}
        <div className="relative overflow-hidden" style={{ height: "176px" }}>
          {/* Background - lazy loaded image with fallback */}
          <LazyImage
            src={event.imageUrl || event.source_image_url}
            alt={event.title}
            className="absolute inset-0 w-full h-full"
            fallback={
              <div
                className={`absolute inset-0 ${
                  isPromoted
                    ? "bg-gradient-to-br from-yellow-100 to-yellow-50"
                    : "bg-gradient-to-br from-muted to-muted/80"
                } flex items-center justify-center`}
              >
                <ImageOff className="w-8 h-8 text-muted-foreground/40" />
              </div>
            }
            placeholder={
              <div
                className={`absolute inset-0 ${
                  isPromoted
                    ? "bg-gradient-to-br from-yellow-100 to-yellow-50"
                    : "bg-gradient-to-br from-muted to-muted/80"
                } animate-pulse`}
              />
            }
          />
          {/* Category Badge - Top Left (Pastel styling) */}
          <BadgeMask variant="top-left">
            <span
              className={`font-bold text-[10px] px-2 py-0.5 block rounded-full ${
                getCategoryClasses(event.category || 'Events').bg
              } ${getCategoryClasses(event.category || 'Events').text}`}
            >
              {translateCategory(event.category || 'Events', t)}
            </span>
          </BadgeMask>

          {/* Promoted Badge - Below Category on left side */}
          {isPromoted && (
            <div className="absolute top-8 left-2 z-10">
              <span className="bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {t("events.promoted")}
              </span>
            </div>
          )}

          {/* Menu Badge - Top Right */}
          <BadgeMask variant="top-right">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-muted text-foreground flex items-center justify-center hover:bg-gray-200 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-48 p-1"
                align="end"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-gray-200 text-foreground transition-colors text-left"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await shareEvent(event);
                      } catch (error) {
                        // Silently fail - user will see the error message from shareEvent
                      }
                    }}
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    {t("common.share")}
                  </button>
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-gray-200 text-foreground transition-colors text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSaveEvent(event.id);
                    }}
                  >
                    <Heart className={`w-3.5 h-3.5 ${isSaved ? "fill-error text-error" : ""}`} />
                    {isSaved ? t("common.unsave") : t("common.save")}
                  </button>
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-gray-200 text-foreground transition-colors text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Handle add to calendar
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t("common.addToCalendar")}
                  </button>
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-gray-200 text-foreground transition-colors text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Handle report
                    }}
                  >
                    <Flag className="w-3.5 h-3.5" />
                    {t("common.report")}
                  </button>
                  {isAdmin && (
                    <>
                      <div className="h-px bg-border my-0.5" />
                      <button
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-primary/10 text-primary transition-colors text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit?.(event);
                        }}
                      >
                        <Edit className="w-3.5 h-3.5" />
                        {t("common.edit")}
                      </button>
                      <button
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-error/10 text-error transition-colors text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeleteConfirm(true);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
              <Users className="w-3 h-3" strokeWidth={2} />
              <span className="truncate max-w-[100px]">
                {event.organization || event.display_handle || ''}
              </span>
            </span>
          </BadgeMask>
        </div>

        {/* Event Content */}
        <div className="relative flex flex-col flex-1 px-4 pt-4 pb-3 border-l border-r border-b border-border rounded-b-xl">
          <LightRays />
          {/* Title and Badges Row */}
          <div className="flex items-start gap-3 h-full flex-1">
            {/* Left side: Title, Date, Location */}
            <div className="flex-1 min-w-0 flex flex-col h-full gap-4">
              <h3 className="font-bold text-base leading-tight line-clamp-2 text-foreground">
                {event.title}
              </h3>

              {/* Event Info */}
              <div className="space-y-0.5 mb-0 mt-auto">
                {/* Date */}
                <div className="flex gap-1.5 items-center">
                  <span className="text-[11px] text-muted-foreground">
                    {cardDate}
                  </span>
                </div>

                {/* Time */}
                <div className="flex gap-1.5 items-center">
                  <span className="text-[11px] text-muted-foreground">
                    {cardTime}
                  </span>
                </div>

                {/* Location */}
                <div className="flex gap-1.5 items-center">
                  <span className="text-[11px] text-muted-foreground truncate">
                    {event.location}
                  </span>
                </div>
              </div>
            </div>

            {/* Right side: Event Badges - Stacked vertically, right aligned */}
            {badges.length > 0 && (
              <div className="flex flex-col gap-1.5 items-end shrink-0">
                {badges.map((badge) => (
                  <span
                    key={badge.text}
                    className={`font-medium text-[10px] px-2 py-0.5 rounded-xl ${badge.bgClass} ${badge.textClass}`}
                  >
                    {badge.text}
                  </span>
                ))}
              </div>
            )}
          </div>

        </div>
      </article>

      {/* Event Details Modal */}
      {showDetailsModal && (
        <EventDetailsModal
          event={event}
          onClose={() => {
            const newParams = new URLSearchParams(searchParams);
            newParams.delete("eventId");
            navigate(newParams.toString() ? `/?${newParams.toString()}` : "/", { replace: false });
          }}
          allEvents={allEvents}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={showDeleteConfirm}
        onOpenChange={(open) => !open && setShowDeleteConfirm(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("events.deleteEventTitle")}</DialogTitle>
            <DialogDescription>
              {t("events.deleteEventConfirm", { title: event.title })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
            >
              {t("common.cancel")}
            </Button>
            <LoadingButton
              variant="destructive"
              onClick={async () => {
                setIsDeleting(true);
                try {
                  await Promise.resolve(onDelete?.(event.id));
                  setShowDeleteConfirm(false);
                } finally {
                  setIsDeleting(false);
                }
              }}
              isLoading={isDeleting}
              loadingText={t("common.pleaseWait") || "Please wait..."}
            >
              {t("common.delete")}
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});
