import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  InfoSection,
  SectionTitle,
  FoodTagsContainer,
  FoodTag,
} from "@/shared/ui/modal-components";
import { useModalState } from "@/shared/hooks/useModalState";
import type { Event } from "@/shared/types";

function formatDisplayDate(event: Event): string {
  if (event.date) return event.date;
  const raw = event.dtstart_utc || event.eventDate;
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function formatDisplayTime(event: Event): string {
  if (event.time) return event.time;
  const raw = event.dtstart_utc || event.eventDate;
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  const end = event.dtend_utc ? new Date(event.dtend_utc) : null;
  const start = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (end && !isNaN(end.getTime())) {
    return `${start} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return start;
}

interface EventDetailsModalProps {
  event: Event | null;
  onClose: () => void;
  allEvents?: Event[];
  /** When true, the Similar Events section is hidden (e.g. in admin panel). */
  hideSimilarEvents?: boolean;
}

export function EventDetailsModal({
  event,
  onClose,
  allEvents,
  hideSimilarEvents = false,
}: EventDetailsModalProps) {
  const { t } = useTranslation();
  const [displayedEvent, setDisplayedEvent] = useState<Event | null>(event);

  useEffect(() => {
    setDisplayedEvent(event);
  }, [event]);

  const isOpen = event !== null;

  const similarEvents = useMemo(() => {
    if (!displayedEvent) return [];
    const eventsList = allEvents || [];
    const otherEvents = eventsList.filter((e) => e.id !== displayedEvent.id);
    const seed = displayedEvent.id;
    const shuffled = [...otherEvents].sort((a, b) => {
      const hashA = ((seed * a.id) % 1000) / 1000;
      const hashB = ((seed * b.id) % 1000) / 1000;
      return hashA - hashB;
    });
    return shuffled.slice(0, 4);
  }, [displayedEvent, allEvents]);

  const handleSimilarEventClick = useCallback((clickedEvent: Event) => {
    setDisplayedEvent(clickedEvent);
    document.querySelector("[data-slot='dialog-content']")?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const modalState = useModalState({ onClose });

  return (
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {displayedEvent && (
          <>
            <div className="relative w-full h-64 overflow-hidden">
              <LazyImage
                src={displayedEvent.imageUrl || displayedEvent.source_image_url}
                alt={displayedEvent.title}
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
                <DialogTitle>{displayedEvent.title}</DialogTitle>
                <DialogDescription>{displayedEvent.organization}</DialogDescription>
              </DialogHeader>

              <ModalSection>
                <InfoRow
                  label={t("forms.description")}
                  value={displayedEvent.description || t("common.noDescription")}
                />

                {displayedEvent.source_url && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-900 mb-1">
                      {t("events.sourceLink")}
                    </h3>
                    <a
                      href={displayedEvent.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span className="truncate">{displayedEvent.source_url}</span>
                    </a>
                  </div>
                )}

                <InfoGrid>
                  <InfoRow label={t("filters.date")} value={formatDisplayDate(displayedEvent)} />
                  <InfoRow label={t("forms.time")} value={formatDisplayTime(displayedEvent)} />
                </InfoGrid>

                <InfoRow label={t("filters.location")} value={displayedEvent.location} />
                <InfoRow
                  label={t("filters.category")}
                  value={displayedEvent.category ? translateCategory(displayedEvent.category, t) : t("common.none")}
                />
                <InfoRow
                  label={t("filters.price")}
                  value={displayedEvent.price === 0 ? t("common.free") : `$${displayedEvent.price}`}
                />

                {displayedEvent.food && displayedEvent.food.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-900 mb-1">
                      {t("forms.foodProvided")}
                    </h3>
                    <FoodTagsContainer>
                      {displayedEvent.food.map((food) => (
                        <FoodTag key={food}>{food}</FoodTag>
                      ))}
                    </FoodTagsContainer>
                  </div>
                )}

                <InfoRow
                  label={t("filters.requiresRegistration")}
                  value={displayedEvent.requiresRegistration ? t("common.yes") : t("common.no")}
                />
                <InfoRow
                  label={t("events.status")}
                  value={displayedEvent.isLive ? t("common.live") : t("common.notLive")}
                />

                {displayedEvent.dayOfWeek && (
                  <InfoRow label={t("events.dayOfWeek")} value={displayedEvent.dayOfWeek} />
                )}

                {!hideSimilarEvents && similarEvents.length > 0 && (
                  <InfoSection>
                    <SectionTitle>{t("events.similarEvents")}</SectionTitle>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {similarEvents.map((similarEvent) => (
                        <EventCard
                          key={similarEvent.id}
                          event={similarEvent}
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
