import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Users,
  Calendar,
  MapPin,
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
import { Badge } from "./ui/badge";
import { InteractiveHoverButton } from "./ui/interactive-hover-button";
import { BadgeMask } from "./ui/badge-mask";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { LightRays } from "./ui/light-rays";
import { LazyImage } from "./LazyImage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { EventDetailsModal } from "./EventDetailsModal";
import { shareEvent } from "@/utils/shareEvent";
import type { Event } from "@/types";

interface EventCardProps {
  event: Event;
  isSaved?: boolean;
  isPromoted?: boolean;
  onToggleSave?: (eventId: number) => void;
  isAdmin?: boolean;
  onEdit?: (event: Event) => void;
  onDelete?: (eventId: number) => void;
  allEvents?: Event[]; // For similar events in modal
  onEventClick?: (event: Event) => void; // Optional: custom click handler instead of opening modal
  disableModal?: boolean; // If true, don't open modal on click
}

// Category color mapping - returns Tailwind classes using tokens
const getCategoryClasses = (category: string): { bg: string; text: string } => {
  const mapping: Record<string, { bg: string; text: string }> = {
    Events: { bg: "bg-category-events-bg", text: "text-category-events-text" },
    Clubs: { bg: "bg-category-clubs-bg", text: "text-category-clubs-text" },
    Academic: {
      bg: "bg-category-academic-bg",
      text: "text-category-academic-text",
    },
    Religious: {
      bg: "bg-category-religious-bg",
      text: "text-category-religious-text",
    },
    Cultural: {
      bg: "bg-category-cultural-bg",
      text: "text-category-cultural-text",
    },
    "Social & Games": {
      bg: "bg-category-social-bg",
      text: "text-category-social-text",
    },
    Sports: { bg: "bg-category-sports-bg", text: "text-category-sports-text" },
    Career: { bg: "bg-category-career-bg", text: "text-category-career-text" },
  };
  return (
    mapping[category] || {
      bg: "bg-category-default-bg",
      text: "text-category-default-text",
    }
  );
};

export const EventCard = React.memo(function EventCard({
  event,
  isSaved = false,
  isPromoted = false,
  onToggleSave,
  isAdmin = false,
  onEdit,
  onDelete,
  allEvents,
  onEventClick,
  disableModal = false,
}: EventCardProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Check if this event should be shown in modal based on URL
  const eventIdParam = searchParams.get("eventId");
  const showDetailsModal = !disableModal && eventIdParam === event.id.toString();

  // Generate event badges with token classes
  const getBadges = () => {
    const badges: { text: string; bgClass: string; textClass: string }[] = [];

    // Price badge
    if (event.price === 0) {
      badges.push({
        text: "Free",
        bgClass: "bg-success/20",
        textClass: "text-success",
      });
    } else {
      badges.push({
        text: `$${event.price}`,
        bgClass: "bg-primary/20",
        textClass: "text-primary",
      });
    }

    // Food badge
    if (event.food && event.food.length > 0) {
      badges.push({
        text: "Free Food",
        bgClass: "bg-warning/20",
        textClass: "text-warning",
      });
    }

    // Registration badge
    if (event.requiresRegistration) {
      badges.push({
        text: "Registration",
        bgClass: "bg-purple-500/20",
        textClass: "text-purple-500",
      });
    }

    return badges;
  };

  const badges = getBadges();

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
            src={event.imageUrl}
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
                getCategoryClasses(event.category).bg
              } ${getCategoryClasses(event.category).text}`}
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
                        console.error("Failed to share event:", error);
                        // You could show a toast notification here
                      }
                    }}
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    Share
                  </button>
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-gray-200 text-foreground transition-colors text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSave?.(event.id);
                    }}
                  >
                    <Heart className={`w-3.5 h-3.5 ${isSaved ? "fill-error text-error" : ""}`} />
                    {isSaved ? "Unsave" : "Save"}
                  </button>
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-gray-200 text-foreground transition-colors text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Handle add to calendar
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Add to Calendar
                  </button>
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-gray-200 text-foreground transition-colors text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Handle report
                    }}
                  >
                    <Flag className="w-3.5 h-3.5" />
                    Report
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
                        Edit
                      </button>
                      <button
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-xl hover:bg-error/10 text-error transition-colors text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeleteConfirm(true);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
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
                {event.organization}
              </span>
            </span>
          </BadgeMask>
        </div>

        {/* Event Content */}
        <div className="relative flex flex-col flex-1 px-4 pt-4 pb-3 border-l border-r border-b border-border rounded-b-xl">
          <LightRays />
          {/* Title and Badges Row */}
          <div className="flex items-start gap-3 mb-2">
            {/* Left side: Title, Date, Location */}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base leading-tight mb-2 line-clamp-2 text-foreground">
                {event.title}
              </h3>

              {/* Event Info */}
              <div className="space-y-1 mb-0">
                {/* Date & Time */}
                <div className="flex gap-1.5 items-center">
                  <span className="text-[11px] truncate text-muted-foreground">
                    {event.date} at {event.time}
                  </span>
                </div>

                {/* Location */}
                <div className="flex gap-1.5 items-center">
                  <span className="text-[11px] truncate text-muted-foreground">
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
            <DialogTitle>Delete Event</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{event.title}"? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onDelete?.(event.id);
                setShowDeleteConfirm(false);
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});
