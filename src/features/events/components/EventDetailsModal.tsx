import React, { useMemo } from "react";
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
  ModalImageHeader,
  InfoSection,
  SectionTitle,
  FoodTagsContainer,
  FoodTag,
} from "@/shared/ui/modal-components";
import { useModalState } from "@/shared/hooks/useModalState";
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

  // Derive isOpen from event presence
  const isOpen = event !== null;

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
    // Note: Parent component should handle event change via onEventChange callback
    // Scroll handled by Dialog component automatically
  };

  // Use modal state hook for standardized open/close handling
  const modalState = useModalState({ onClose });

  return (
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {event && (
          <>
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

            <ModalContentWrapper>
              <DialogHeader>
                <DialogTitle>{event.title}</DialogTitle>
                <DialogDescription>{event.organization}</DialogDescription>
              </DialogHeader>

              <ModalSection>
                <InfoRow
                  label={t("forms.description")}
                  value={event.description || t("common.noDescription")}
                />

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

                <InfoGrid>
                  <InfoRow label={t("filters.date")} value={event.date} />
                  <InfoRow label={t("forms.time")} value={event.time} />
                </InfoGrid>

                <InfoRow label={t("filters.location")} value={event.location} />
                <InfoRow
                  label={t("filters.category")}
                  value={event.category ? translateCategory(event.category, t) : t("common.none")}
                />
                <InfoRow
                  label={t("filters.price")}
                  value={event.price === 0 ? t("common.free") : `$${event.price}`}
                />

                {event.food && event.food.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-900 mb-1">
                      {t("forms.foodProvided")}
                    </h3>
                    <FoodTagsContainer>
                      {event.food.map((food) => (
                        <FoodTag key={food}>{food}</FoodTag>
                      ))}
                    </FoodTagsContainer>
                  </div>
                )}

                <InfoRow
                  label={t("filters.requiresRegistration")}
                  value={event.requiresRegistration ? t("common.yes") : t("common.no")}
                />
                <InfoRow
                  label={t("events.status")}
                  value={event.isLive ? t("common.live") : t("common.notLive")}
                />

                {event.dayOfWeek && (
                  <InfoRow label={t("events.dayOfWeek")} value={event.dayOfWeek} />
                )}

                {similarEvents.length > 0 && (
                  <InfoSection>
                    <SectionTitle>{t("events.similarEvents")}</SectionTitle>
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
                  </InfoSection>
                )}
              </ModalSection>
            </ModalContentWrapper>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
