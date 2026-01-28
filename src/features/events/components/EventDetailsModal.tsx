import React, { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { EventCard } from "@/features/events/components/EventCard";
import { translateCategory } from "@/shared/utils/event";
import { LazyImage } from "@/shared/ui/lazy-image";
import {
  ModalContentWrapper,
  ModalSection,
  InfoRow,
  InfoGrid,
} from "@/shared/ui/modal-components";
import type { Event } from "@/shared/types";
import { mockEvents } from "@/features/events/data/events";

interface EventDetailsModalProps {
  event: Event | null;
  onClose: () => void;
  allEvents?: Event[]; // Pass all events for similar events calculation
}

export function EventDetailsModal({
  event,
  onClose,
  allEvents,
}: EventDetailsModalProps) {
  const { t } = useTranslation();
  const dialogContentRef = useRef<HTMLDivElement>(null);

  // Get similar events (4 random events excluding the current one)
  const similarEvents = useMemo(() => {
    if (!event) return [];
    const eventsList = allEvents || mockEvents;
    const otherEvents = eventsList.filter((e) => e.id !== event.id);
    // Shuffle using a stable seed based on current event ID
    const seed = event.id;
    const shuffled = [...otherEvents].sort((a, b) => {
      // Simple seeded hash function
      const hashA = ((seed * a.id) % 1000) / 1000;
      const hashB = ((seed * b.id) % 1000) / 1000;
      return hashA - hashB;
    });
    return shuffled.slice(0, 4);
  }, [event, allEvents]);

  const handleSimilarEventClick = (clickedEvent: Event) => {
    // Scroll to top of modal when navigating to similar event
    if (dialogContentRef.current) {
      dialogContentRef.current.scrollTop = 0;
    }
    // Note: Parent component should handle event change via onEventChange callback
    // For now, we'll just scroll - actual navigation would require prop drilling or context
  };

  const isOpen = event !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {event && (
          <>
            {/* Event Image at Top */}
            <div className="relative w-full h-64 overflow-hidden">
              <LazyImage
                src={event.imageUrl}
                alt={event.title}
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
                <DialogTitle>{event.title}</DialogTitle>
                <DialogDescription>{event.organization}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm text-gray-900 mb-1">
                    {t("forms.description")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {event.description || t("common.noDescription")}
                  </p>
                </div>

                {event.source_url && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-900 mb-1">
                      {t("events.sourceLink")}
                    </h3>
                    <a
                      href={event.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span className="truncate">{event.source_url}</span>
                    </a>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("filters.date")}</h3>
                    <p className="text-sm text-muted-foreground">{event.date}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("forms.time")}</h3>
                    <p className="text-sm text-muted-foreground">{event.time}</p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("filters.location")}</h3>
                  <p className="text-sm text-muted-foreground">{event.location}</p>
                </div>

                <div>
                  <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("filters.category")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {event.category ? translateCategory(event.category, t) : t("common.none")}
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("filters.price")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {event.price === 0 ? t("common.free") : `$${event.price}`}
                  </p>
                </div>

                {event.food && event.food.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-900 mb-1">
                      {t("forms.foodProvided")}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {event.food.map((food) => (
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
                    {t("filters.requiresRegistration")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {event.requiresRegistration ? t("common.yes") : t("common.no")}
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-sm text-gray-900 mb-1">{t("events.status")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {event.isLive ? t("common.live") : t("common.notLive")}
                  </p>
                </div>

                {event.dayOfWeek && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-900 mb-1">
                      {t("events.dayOfWeek")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {event.dayOfWeek}
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
