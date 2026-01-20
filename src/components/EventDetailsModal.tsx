import React, { useMemo, useState, useEffect } from "react";
import { Calendar, MapPin, DollarSign, Users, Utensils, Tag, ImageOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { EventCard } from "./EventCard";
import { LazyImage } from "./LazyImage";
import type { Event } from "@/types";
import { mockEvents } from "@/data/events";

interface EventDetailsModalProps {
  event: Event | null;
  onClose: () => void;
  allEvents?: Event[]; // Optional: pass all events for similar events calculation
}

export function EventDetailsModal({
  event: initialEvent,
  onClose,
  allEvents,
}: EventDetailsModalProps) {
  const [currentEvent, setCurrentEvent] = useState(initialEvent);

  // Update current event when initialEvent changes
  useEffect(() => {
    setCurrentEvent(initialEvent);
  }, [initialEvent]);

  // Get similar events (4 random events excluding the current one)
  const similarEvents = useMemo(() => {
    if (!currentEvent) return [];
    const eventsList = allEvents || mockEvents;
    const otherEvents = eventsList.filter((e) => e.id !== currentEvent.id);
    // Shuffle and take 4
    const shuffled = [...otherEvents].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 4);
  }, [currentEvent, allEvents]);

  const handleSimilarEventClick = (event: Event) => {
    setCurrentEvent(event);
    // Scroll to top of modal
    const dialogContent = document.querySelector('[role="dialog"]');
    if (dialogContent) {
      dialogContent.scrollTop = 0;
    }
  };

  if (!currentEvent) return null;

  return (
    <Dialog open={currentEvent !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {/* Event Image at Top */}
        <div className="relative w-full h-64 overflow-hidden">
          <LazyImage
            src={currentEvent.imageUrl}
            alt={currentEvent.title}
            className="absolute inset-0 w-full h-full object-cover"
            fallback={
              <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 flex items-center justify-center">
                <ImageOff className="w-12 h-12 text-muted-foreground/40" />
              </div>
            }
            placeholder={
              <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 animate-pulse" />
            }
          />
        </div>

        <div className="p-6 space-y-4">
          <DialogHeader>
            <DialogTitle>{currentEvent.title}</DialogTitle>
            <DialogDescription>{currentEvent.organization}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">
                Description
              </h3>
              <p className="text-sm text-muted-foreground">
                {currentEvent.description || "No description"}
              </p>
            </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">Date</h3>
              <p className="text-sm text-muted-foreground">{currentEvent.date}</p>
            </div>
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">Time</h3>
              <p className="text-sm text-muted-foreground">{currentEvent.time}</p>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">Location</h3>
            <p className="text-sm text-muted-foreground">{currentEvent.location}</p>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">Category</h3>
            <p className="text-sm text-muted-foreground">
              {currentEvent.category || "None"}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">Price</h3>
            <p className="text-sm text-muted-foreground">
              {currentEvent.price === 0 ? "Free" : `$${currentEvent.price}`}
            </p>
          </div>

          {currentEvent.food && currentEvent.food.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">
                Food Provided
              </h3>
              <div className="flex flex-wrap gap-2">
                {currentEvent.food.map((food) => (
                  <span
                    key={food}
                    className="text-xs px-2 py-1 bg-warning/20 text-warning rounded-full"
                  >
                    {food}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">
              Requires Registration
            </h3>
            <p className="text-sm text-muted-foreground">
              {currentEvent.requiresRegistration ? "Yes" : "No"}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">Status</h3>
            <p className="text-sm text-muted-foreground">
              {currentEvent.isLive ? "Live" : "Not Live"}
            </p>
          </div>

          {currentEvent.dayOfWeek && (
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">
                Day of Week
              </h3>
              <p className="text-sm text-muted-foreground">
                {currentEvent.dayOfWeek}
              </p>
            </div>
          )}

          {/* Similar Events Section */}
          {similarEvents.length > 0 && (
            <div className="border-t border-border pt-4 mt-4">
              <h3 className="font-semibold text-sm text-gray-900 mb-4">
                Similar Events
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {similarEvents.map((similarEvent) => (
                  <EventCard 
                    key={similarEvent.id} 
                    event={similarEvent} 
                    allEvents={allEvents}
                    onEventClick={handleSimilarEventClick}
                    disableModal={true}
                  />
                ))}
              </div>
            </div>
          )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
