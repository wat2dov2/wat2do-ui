import React, { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, MapPin, DollarSign, Users, Utensils, Tag, ImageOff, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { EventCard, translateCategory } from "./EventCard";
import { LazyImage } from "./LazyImage";
import type { Event } from "@/types";
import { mockEvents } from "@/data/events";

interface EventDetailsModalProps {
  event: Event | null;
  onClose: () => void;
  allEvents?: Event[]; // Pass all events for similar events calculation
}

export function EventDetailsModal({
  event: initialEvent,
  onClose,
  allEvents,
}: EventDetailsModalProps) {
  const { t } = useTranslation();
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

  const isOpen = currentEvent !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {currentEvent && (
          <>
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
              {t("events.description")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {currentEvent.description || t("common.noDescription")}
            </p>
          </div>

          {currentEvent.source_url && (
            <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">
              {t("events.sourceLink")}
            </h3>
              <a
                href={currentEvent.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="truncate">{currentEvent.source_url}</span>
              </a>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("events.date")}</h3>
              <p className="text-sm text-muted-foreground">{currentEvent.date}</p>
            </div>
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("events.time")}</h3>
              <p className="text-sm text-muted-foreground">{currentEvent.time}</p>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("events.location")}</h3>
            <p className="text-sm text-muted-foreground">{currentEvent.location}</p>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("events.category")}</h3>
            <p className="text-sm text-muted-foreground">
              {currentEvent.category ? translateCategory(currentEvent.category, t) : t("common.none")}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("events.price")}</h3>
            <p className="text-sm text-muted-foreground">
              {currentEvent.price === 0 ? t("common.free") : `$${currentEvent.price}`}
            </p>
          </div>

          {currentEvent.food && currentEvent.food.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">
                {t("events.foodProvided")}
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
              {t("events.requiresRegistration")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {currentEvent.requiresRegistration ? t("common.yes") : t("common.no")}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("events.status")}</h3>
            <p className="text-sm text-muted-foreground">
              {currentEvent.isLive ? t("common.live") : t("common.notLive")}
            </p>
          </div>

          {currentEvent.dayOfWeek && (
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">
                {t("events.dayOfWeek")}
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
