import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Heart, ImageOff, Users } from "lucide-react";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";
import { useEventsContextOptional } from "@/features/events/context/EventsContext";
import { useAppContext } from "@/contexts/AppContext";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import type { Event } from "@/shared/types";

interface EventCardProps {
  event: Event;
  cardIndex?: number;
  isSaved?: boolean;
  isPromoted?: boolean;
  onEventClick?: (event: Event) => void;
  disableModal?: boolean;
}


export const EventCard = React.memo(function EventCard({
  event,
  cardIndex = 0,
  isSaved = false,
  isPromoted = false,
  onEventClick: propOnEventClick,
  disableModal: propDisableModal,
}: EventCardProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  
  // Get values from context (with prop overrides)
  // Use optional context - returns null when not inside EventsProvider
  const context = useEventsContextOptional();
  const { profileCompleted } = useAppContext();

  const allEvents = context?.allEvents ?? [];
  const contextOnEventClick = context?.onEventClick;
  const contextDisableModal = context?.disableModal;
  
  // Use prop values if provided, otherwise fall back to context
  const onEventClick = propOnEventClick ?? contextOnEventClick;
  const disableModal = propDisableModal ?? contextDisableModal;
  
  // Check if this event should be shown in modal based on URL
  const eventIdParam = searchParams.get("eventId");
  const showDetailsModal = !disableModal && eventIdParam === event.id.toString();

  // Format date and time using shared utilities
  const cardDate = formatCardDate(event, i18n.language || 'en-US');
  const cardTime = formatCardTime(event);
  const organizationText = event.organization || event.display_handle || "";

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
        data-card-index={cardIndex}
        className={`group flex h-full cursor-pointer flex-col rounded-none border-10 border-white bg-white ${
          isPromoted
            ? "outline-2 outline-[#d4a06d]"
            : ""
        }`}
      >
        {/* Event Image */}
        <div className="relative overflow-hidden bg-[#ece8df]" style={{ height: "198px" }}>
          <LazyImage
            src={event.imageUrl || event.source_image_url}
            alt={event.title}
            className="absolute inset-0 w-full h-full"
            fallback={
              <div
                className={`absolute inset-0 ${
                  isPromoted
                    ? "bg-linear-to-br from-[#f7e7c8] to-[#fbeed8]"
                    : "bg-linear-to-br from-[#ece8df] to-[#dfd7cd]"
                } flex items-center justify-center`}
              >
                <ImageOff className="w-8 h-8 text-muted-foreground/40" />
              </div>
            }
            placeholder={
              <div
                className={`absolute inset-0 ${
                  isPromoted
                    ? "bg-linear-to-br from-[#f7e7c8] to-[#fbeed8]"
                    : "bg-linear-to-br from-[#ece8df] to-[#dfd7cd]"
                } animate-pulse`}
              />
            }
          />
        </div>

        {/* White info strip with black text */}
        <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-3 text-black">
          <h3 className="line-clamp-2 text-base font-semibold leading-tight">
            {event.title}
          </h3>
          <p className="line-clamp-1 text-[11px] text-black/85">{organizationText}</p>
          <div className="mt-auto space-y-0.5 text-[11px] text-black/75">
            <p>{cardDate}</p>
            <p>{cardTime}</p>
            <p className="line-clamp-1">{event.location}</p>
          </div>
          {profileCompleted && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-black/75">
              <Heart className={`h-3.5 w-3.5 ${isSaved ? "fill-black text-black" : ""}`} />
              <span>{isSaved ? "Saved" : t("common.save")}</span>
            </div>
          )}
          {isPromoted && (
            <p className="text-[11px] font-medium text-black/80">{t("events.promoted")}</p>
          )}
          {event.category && (
            <div className="flex items-center gap-1 text-[11px] text-black/70">
              <Users className="h-3.5 w-3.5" />
              <span className="line-clamp-1">{event.category}</span>
            </div>
          )}
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
    </>
  );
});
