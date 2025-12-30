import React, { useState } from "react";
import { Users, Calendar, MapPin, Download, Heart, Check, Sparkles } from "lucide-react";
import { EventModal } from "./EventModal";
import { Badge } from "./ui/badge";
import { BadgeMask } from "./ui/badge-mask";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { Event } from "@/types";

interface EventCardProps {
  event: Event;
  inModal?: boolean;
  onEventClick?: (event: Event) => void;
  isSaved?: boolean;
  isRegistered?: boolean;
  isPromoted?: boolean;
  onToggleSave?: (eventId: number) => void;
  onToggleRegister?: (eventId: number) => void;
}

// Category color mapping
const categoryColors: Record<string, string> = {
  "Events": "#2563EB",
  "Clubs": "#16A34A",
  "Academic": "#D97706",
  "Religious": "#A855F7",
  "Cultural": "#E11D48",
  "Social & Games": "#0891B2",
  "Sports": "#DC2626",
  "Career": "#0369A1",
};

export const EventCard = React.memo(function EventCard({
  event,
  inModal = false,
  onEventClick,
  isSaved = false,
  isRegistered = false,
  isPromoted = false,
  onToggleSave,
  onToggleRegister,
}: EventCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleViewMore = () => {
    if (inModal && onEventClick) {
      onEventClick(event);
    } else {
      setIsModalOpen(true);
    }
  };

  // Get category color
  const getCategoryColor = (category: string) => {
    return categoryColors[category] || "#6B7280";
  };

  // Generate event badges
  const getBadges = () => {
    const badges: { text: string; color: string }[] = [];

    // Price badge
    if (event.price === 0) {
      badges.push({ text: "Free", color: "#10B981" });
    } else {
      badges.push({ text: `$${event.price}`, color: "#3B82F6" });
    }

    // Food badge
    if (event.food && event.food.length > 0) {
      badges.push({ text: "Free Food", color: "#F59E0B" });
    }

    // Registration badge
    if (event.requiresRegistration) {
      badges.push({ text: "Registration Required", color: "#8B5CF6" });
    }

    return badges;
  };

  const badges = getBadges();

  return (
    <>
      <article
        data-event-card
        className={`rounded overflow-hidden hover:shadow-lg transition-all duration-300 group flex flex-col h-full ${
          isPromoted ? "ring-2 ring-amber-400 shadow-amber-100 shadow-md" : ""
        }`}
        style={{ backgroundColor: "#fff", border: isPromoted ? "1px solid #fbbf24" : "1px solid #e5e7eb" }}
      >
        {/* Event Image */}
        <div
          className="relative overflow-hidden"
          style={{ height: "176px", background: isPromoted ? "linear-gradient(to bottom right, #fef3c7, #fde68a)" : "linear-gradient(to bottom right, #e5e7eb, #d1d5db)" }}
        >
          {/* Promoted Badge */}
          {isPromoted && (
            <BadgeMask variant="top-left">
              <span className="bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                PROMOTED
              </span>
            </BadgeMask>
          )}

          {/* LIVE Badge */}
          {event.isLive && (
            <BadgeMask variant="top-right">
              <Badge variant="live" className="font-extrabold">
                LIVE
              </Badge>
            </BadgeMask>
          )}

          {/* Category Badge */}
          <BadgeMask variant="bottom-left">
            <span
              className="font-bold text-[10px] px-2 py-0.5 block rounded-full"
              style={{
                backgroundColor: getCategoryColor(event.category),
                color: "#ffffff"
              }}
            >
              {event.category}
            </span>
          </BadgeMask>
        </div>

        {/* Event Content */}
        <div className="flex flex-col flex-1 p-4">
          {/* Organization */}
          <div className="flex gap-2.5 items-center mb-3">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(to bottom right, rgba(59,130,246,0.2), rgba(59,130,246,0.1))" }}
            >
              <Users className="w-3.5 h-3.5" style={{ color: "#3B82F6" }} strokeWidth={2.5} />
            </div>
            <span className="font-bold text-[11px] truncate" style={{ color: "#111827" }}>
              {event.organization}
            </span>
          </div>

          {/* Event Badges */}
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {badges.map((badge) => (
                <span
                  key={badge.text}
                  className="text-white font-medium text-[10px] px-2 py-0.5 rounded"
                  style={{ backgroundColor: badge.color }}
                >
                  {badge.text}
                </span>
              ))}
            </div>
          )}

          {/* Title */}
          <h3 className="font-medium text-[12px] leading-tight mb-2 line-clamp-2" style={{ color: "#4B5563" }}>
            {event.title}
          </h3>

          {/* Event Info */}
          <div className="space-y-1 mb-3 flex-1">
            {/* Date & Time */}
            <div className="flex gap-1.5 items-center">
              <Calendar className="w-3 h-3 flex-shrink-0" style={{ color: "#9CA3AF" }} strokeWidth={2} />
              <span className="text-[11px] truncate" style={{ color: "#4B5563" }}>
                {event.date} at {event.time}
              </span>
            </div>

            {/* Location */}
            <div className="flex gap-1.5 items-center">
              <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: "#9CA3AF" }} strokeWidth={2} />
              <span className="text-[11px] truncate" style={{ color: "#4B5563" }}>
                {event.location}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px mb-4" style={{ background: "linear-gradient(to right, transparent, #e5e7eb, transparent)" }} />

          {/* Action Buttons */}
          <div className="flex gap-2 items-center">
            {isRegistered ? (
              <button
                className="flex-1 font-medium text-[11px] h-8 rounded transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-green-100 text-green-700 border border-green-200"
              >
                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                Registered
              </button>
            ) : (
              <button
                onClick={handleViewMore}
                className="flex-1 text-white font-medium text-[11px] h-8 rounded hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                style={{ backgroundColor: "#3B82F6" }}
              >
                View More
              </button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="w-8 h-8 rounded flex items-center justify-center hover:bg-blue-50 active:scale-95 transition-all flex-shrink-0 cursor-pointer"
                  style={{ border: "1px solid #e5e7eb" }}
                  aria-label="Add to calendar"
                >
                  <Download className="w-3.5 h-3.5" style={{ color: "#9CA3AF" }} strokeWidth={2} />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Add to calendar</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSave?.(event.id);
                  }}
                  className={`w-8 h-8 rounded flex items-center justify-center active:scale-95 transition-all flex-shrink-0 cursor-pointer ${
                    isSaved
                      ? "bg-red-50 border-red-200 hover:bg-red-100"
                      : "hover:bg-blue-50"
                  }`}
                  style={{ border: isSaved ? "1px solid #fecaca" : "1px solid #e5e7eb" }}
                  aria-label={isSaved ? "Remove from saved" : "Save event"}
                >
                  <Heart
                    className={`w-3.5 h-3.5 transition-colors ${isSaved ? "fill-red-500 text-red-500" : ""}`}
                    style={{ color: isSaved ? "#ef4444" : "#9CA3AF" }}
                    strokeWidth={2}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isSaved ? "Remove from saved" : "Save event"}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </article>

      {/* Event Details Modal */}
      {!inModal && isModalOpen && (
        <EventModal event={event} onClose={() => setIsModalOpen(false)} />
      )}
    </>
  );
});
