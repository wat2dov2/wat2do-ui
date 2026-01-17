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

// Category color mapping - pastel backgrounds with vibrant text
const categoryColors: Record<string, { bg: string; text: string }> = {
  "Events": { bg: "#DBEAFE", text: "#2563EB" },
  "Clubs": { bg: "#DCFCE7", text: "#16A34A" },
  "Academic": { bg: "#FEF3C7", text: "#D97706" },
  "Religious": { bg: "#F3E8FF", text: "#A855F7" },
  "Cultural": { bg: "#FFE4E6", text: "#E11D48" },
  "Social & Games": { bg: "#CFFAFE", text: "#0891B2" },
  "Sports": { bg: "#FEE2E2", text: "#DC2626" },
  "Career": { bg: "#E0F2FE", text: "#0369A1" },
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
    return categoryColors[category] || { bg: "#F3F4F6", text: "#6B7280" };
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
        className={`rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300 group flex flex-col h-full bg-white dark:bg-gray-800 border ${isPromoted ? "ring-2 ring-amber-400 shadow-amber-100 dark:shadow-amber-900/20 shadow-md border-amber-400" : "border-gray-200 dark:border-gray-700"
          }`}
      >
        {/* Event Image */}
        <div
          className="relative overflow-hidden"
          style={{ height: "176px", background: isPromoted ? "linear-gradient(to bottom right, #fef3c7, #fde68a)" : "linear-gradient(to bottom right, #e5e7eb, #d1d5db)" }}
        >
          {/* Category Badge - Top Left (Pastel styling) */}
          <BadgeMask variant="top-left">
            <span
              className="font-bold text-[10px] px-2 py-0.5 block rounded-full"
              style={{
                backgroundColor: getCategoryColor(event.category).bg,
                color: getCategoryColor(event.category).text
              }}
            >
              {event.category}
            </span>
          </BadgeMask>

          {/* Promoted Badge - Below Category on left side */}
          {isPromoted && (
            <div className="absolute top-8 left-2 z-10">
              <span className="bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                PROMOTED
              </span>
            </div>
          )}

          {/* LIVE Badge */}
          {event.isLive && (
            <BadgeMask variant="top-right">
              <Badge variant="live" className="font-extrabold">
                LIVE
              </Badge>
            </BadgeMask>
          )}

          {/* Club Poster Circle with Text - Bottom Left */}
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full border-2 border-white dark:border-gray-700 shadow-lg flex items-center justify-center flex-shrink-0 bg-white dark:bg-gray-800"
              style={{ background: "linear-gradient(to bottom right, rgba(59,130,246,0.2), rgba(59,130,246,0.1))" }}
            >
              <Users className="w-3.5 h-3.5 text-blue-500" strokeWidth={2} />
            </div>
            <span 
              className="font-bold text-[10px] text-white truncate max-w-[120px]"
              style={{ textShadow: "0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)" }}
            >
              {event.organization}
            </span>
          </div>
        </div>

        {/* Event Content */}
        <div className="flex flex-col flex-1 p-4">
          {/* Title - Now at top */}
          <h3 className="font-medium text-[12px] leading-tight mb-2 line-clamp-2 text-gray-900 dark:text-gray-100">
            {event.title}
          </h3>

          {/* Event Badges - Light background styling */}
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {badges.map((badge) => (
                <span
                  key={badge.text}
                  className="font-medium text-[10px] px-2 py-0.5 rounded-xl"
                  style={{
                    backgroundColor: `${badge.color}20`,
                    color: badge.color
                  }}
                >
                  {badge.text}
                </span>
              ))}
            </div>
          )}

          {/* Event Info */}
          <div className="space-y-1 mb-3 flex-1">
            {/* Date & Time */}
            <div className="flex gap-1.5 items-center">
              <Calendar className="w-3 h-3 flex-shrink-0 text-gray-400 dark:text-gray-500" strokeWidth={2} />
              <span className="text-[11px] truncate text-gray-600 dark:text-gray-400">
                {event.date} at {event.time}
              </span>
            </div>

            {/* Location */}
            <div className="flex gap-1.5 items-center">
              <MapPin className="w-3 h-3 flex-shrink-0 text-gray-400 dark:text-gray-500" strokeWidth={2} />
              <span className="text-[11px] truncate text-gray-600 dark:text-gray-400">
                {event.location}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px mb-4 bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent" />

          {/* Action Buttons */}
          <div className="flex gap-2 items-center">
            {isRegistered ? (
              <button
                className="flex-1 font-medium text-[11px] h-8 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
              >
                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                Registered
              </button>
            ) : (
              <button
                onClick={handleViewMore}
                className="flex-1 text-white font-medium text-[11px] h-8 rounded-lg hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer bg-blue-500"
              >
                View More
              </button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-blue-50 dark:hover:bg-gray-700 active:scale-95 transition-all flex-shrink-0 cursor-pointer border border-gray-200 dark:border-gray-700"
                  aria-label="Add to calendar"
                >
                  <Download className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" strokeWidth={2} />
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
                  className={`w-8 h-8 rounded-lg flex items-center justify-center active:scale-95 transition-all flex-shrink-0 cursor-pointer border ${isSaved
                    ? "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50"
                    : "hover:bg-blue-50 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700"
                    }`}
                  aria-label={isSaved ? "Remove from saved" : "Save event"}
                >
                  <Heart
                    className={`w-3.5 h-3.5 transition-colors ${isSaved ? "fill-red-500 text-red-500" : "text-gray-400 dark:text-gray-500"}`}
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
