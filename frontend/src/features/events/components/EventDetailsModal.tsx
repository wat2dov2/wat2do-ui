import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef, type CSSProperties, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { tracker } from "@/shared/services/trackingService";
import { sanitizeHref } from "@/shared/utils/url";
import { formatOccurrence } from "@/shared/utils/date";
import { downloadICS, openGoogleCalendar } from "@/shared/utils/generateICS";
import { ImageOff, ExternalLink, Heart, Share2, Download, Flag } from "@/shared/ui/doodle-icons";
import { AppleIcon, GoogleIcon } from "@/shared/ui/platform-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
// fallow-ignore-next-line circular-dependency
import { EventCard } from "@/features/events/components/EventCard";
import { translateCategory } from "@/shared/utils/event";
import { translateFood } from "@/shared/utils/foodTranslation";
import { LazyImage } from "@/shared/ui/lazy-image";
import {
  ModalContentWrapper,
  ModalSection,
  InfoRow,
  InfoSection,
  SectionTitle,
  FoodTagsContainer,
  FoodTag,
} from "@/shared/ui/modal-components";
import { useModalState } from "@/shared/hooks/useModalState";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { useProfileCompleted } from "@/features/auth/hooks/useAuthState";
import type { Event } from "@/shared/types";

const EventShareDialog = lazy(() =>
  import("@/features/events/components/EventShareDialog").then((module) => ({
    default: module.EventShareDialog,
  })),
);
const EventReportDialog = lazy(() =>
  import("@/features/events/components/EventReportDialog").then((module) => ({
    default: module.EventReportDialog,
  })),
);

const DRAG_CLOSE_THRESHOLD_PX = 120;
type EventDetailsDialog = "share" | "report";

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
  const { t, i18n } = useTranslation();
  const storeEvents = useEventsStore((s) => s.events);
  const savedEventIds = useSavedEventsStore((s) => s.savedEventIds);
  const toggleSaveEvent = useSavedEventsStore((s) => s.toggleSaveEvent);
  const profileCompleted = useProfileCompleted();
  // Local override allows clicking a "similar event" without remounting the
  // modal. We reset it whenever the prop event changes by tracking the prop
  // id during render (React's pattern for prop-derived resets).
  const [overrideEvent, setOverrideEvent] = useState<Event | null>(null);
  const [trackedPropEventId, setTrackedPropEventId] = useState<number | null>(
    event?.id ?? null,
  );
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [activeDialog, setActiveDialog] = useState<EventDetailsDialog | null>(null);
  const dragSessionRef = useRef<{ pointerId: number; startY: number } | null>(null);
  if ((event?.id ?? null) !== trackedPropEventId) {
    setTrackedPropEventId(event?.id ?? null);
    setOverrideEvent(null);
  }
  const displayedEvent = overrideEvent ?? event;

  const isOpen = event !== null;
  const isSaved = displayedEvent ? savedEventIds.includes(displayedEvent.id) : false;

  // Track detail_view on open, dwell time on close
  const openTimeRef = useRef<number>(0);
  useEffect(() => {
    if (displayedEvent) {
      openTimeRef.current = Date.now();
      tracker.track(displayedEvent.id, "detail_view");
    }
    return () => {
      if (displayedEvent && openTimeRef.current > 0) {
        const dwellMs = Date.now() - openTimeRef.current;
        tracker.track(displayedEvent.id, "click", { dwell_time_ms: dwellMs });
        openTimeRef.current = 0;
      }
    };
  }, [displayedEvent]);

  const similarEvents = useMemo(() => {
    if (!displayedEvent) return [];
    const eventsList = allEvents ?? storeEvents;
    const otherEvents = eventsList.filter((e) => e.id !== displayedEvent.id);
    const seed = displayedEvent.id;
    const shuffled = otherEvents.toSorted((a, b) => {
      const hashA = ((seed * a.id) % 1000) / 1000;
      const hashB = ((seed * b.id) % 1000) / 1000;
      return hashA - hashB;
    });
    return shuffled.slice(0, 4);
  }, [displayedEvent, allEvents, storeEvents]);

  const handleSimilarEventClick = useCallback((clickedEvent: Event) => {
    setOverrideEvent(clickedEvent);
    document.querySelector("[data-slot='dialog-content']")?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const resetDrag = useCallback(() => {
    dragSessionRef.current = null;
    setIsDragging(false);
    setDragOffsetY(0);
  }, []);

  const handleDragPointerDown = useCallback((pointerEvent: PointerEvent<HTMLDivElement>) => {
    if (pointerEvent.button !== 0) return;
    dragSessionRef.current = {
      pointerId: pointerEvent.pointerId,
      startY: pointerEvent.clientY,
    };
    setIsDragging(true);
    setDragOffsetY(0);
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
  }, []);

  const handleDragPointerMove = useCallback((pointerEvent: PointerEvent<HTMLDivElement>) => {
    const dragSession = dragSessionRef.current;
    if (!dragSession || dragSession.pointerId !== pointerEvent.pointerId) return;
    setDragOffsetY(Math.max(0, pointerEvent.clientY - dragSession.startY));
  }, []);

  const handleDragPointerEnd = useCallback((pointerEvent: PointerEvent<HTMLDivElement>) => {
    const dragSession = dragSessionRef.current;
    if (!dragSession || dragSession.pointerId !== pointerEvent.pointerId) return;

    const offsetY = Math.max(0, pointerEvent.clientY - dragSession.startY);
    pointerEvent.currentTarget.releasePointerCapture(pointerEvent.pointerId);
    if (offsetY >= DRAG_CLOSE_THRESHOLD_PX) {
      resetDrag();
      onClose();
      return;
    }
    resetDrag();
  }, [onClose, resetDrag]);

  const modalDragStyle = {
    "--event-details-drag-y": `${dragOffsetY}px`,
  } as CSSProperties;

  const modalState = useModalState({ onClose });

  return (
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent
        className={`max-w-2xl max-h-[90vh] overflow-y-auto border-0 p-0 [translate:-50%_calc(-50%+var(--event-details-drag-y,0px))] ${isDragging ? "transition-none" : "transition-[opacity,scale,translate] duration-100"}`}
        style={modalDragStyle}
      >
        {displayedEvent && (
          <>
            <div
              className="relative w-full h-64 touch-none select-none overflow-hidden cursor-grab active:cursor-grabbing"
              data-event-details-drag-handle
              onPointerDown={handleDragPointerDown}
              onPointerMove={handleDragPointerMove}
              onPointerUp={handleDragPointerEnd}
              onPointerCancel={resetDrag}
              onDragStart={(dragEvent) => dragEvent.preventDefault()}
            >
              <div className="absolute top-3 left-1/2 z-10 h-1.5 w-12 -translate-x-1/2 rounded-full bg-background/80 shadow-sm" />
              <LazyImage
                src={displayedEvent.source_image_url ?? undefined}
                alt={displayedEvent.title}
                className="absolute inset-0 w-full h-full object-cover"
                fallback={
                  <div className="absolute inset-0 bg-linear-to-br from-muted to-muted/80 flex items-center justify-center">
                    <ImageOff className="size-12 text-muted-foreground/40" />
                  </div>
                }
                placeholder={
                  <div className="absolute inset-0 bg-linear-to-br from-muted to-muted/80 animate-pulse" />
                }
              />
            </div>

            <ModalContentWrapper>
              <DialogHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <DialogTitle>{displayedEvent.title}</DialogTitle>
                    <DialogDescription>{displayedEvent.organization}</DialogDescription>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 pr-8 sm:pr-0">
                    <Button
                      type="button"
                      variant={isSaved ? "secondary" : "outline"}
                      size="sm"
                      disabled={!profileCompleted}
                      onMouseDown={() => toggleSaveEvent(displayedEvent.id)}
                      className={isSaved ? "border-error/20 bg-error/10 text-error hover:bg-error/15" : ""}
                    >
                      <Heart className={`size-4 ${isSaved ? "fill-current" : ""}`} />
                      {isSaved ? t("common.saved") : t("common.imInterested")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onMouseDown={() => setActiveDialog("share")}
                    >
                      <Share2 className="size-4" />
                      {t("common.share")}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm">
                          <Download className="size-4" />
                          {t("common.export")}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-44" align="end">
                        <DropdownMenuItem onSelect={() => openGoogleCalendar(displayedEvent)}>
                          <GoogleIcon className="size-3.5 shrink-0" />
                          {t("events.calendar.googleCalendar")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => downloadICS(displayedEvent)}>
                          <AppleIcon className="size-3.5 shrink-0" />
                          {t("events.calendar.iCal")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onMouseDown={() => setActiveDialog("report")}
                    >
                      <Flag className="size-4" />
                      {t("common.report")}
                    </Button>
                  </div>
                </div>
              </DialogHeader>

              <ModalSection>
                <InfoRow
                  label={t("forms.description")}
                  value={displayedEvent.description || t("common.noDescription")}
                />

                {displayedEvent.source_url && sanitizeHref(displayedEvent.source_url) && (
                  <div>
                    <h3 className="font-semibold text-sm text-foreground mb-1">
                      {t("events.sourceLink")}
                    </h3>
                    <a
                      href={sanitizeHref(displayedEvent.source_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1.5"
                    >
                      <ExternalLink className="size-3.5" />
                      <span className="truncate">{displayedEvent.source_url}</span>
                    </a>
                  </div>
                )}

                <InfoRow
                  label={t("forms.occurrences")}
                  value={
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {displayedEvent.occurrences?.map((occ) => (
                        <span
                          key={occ.id || `${occ.dtstart_utc}-${occ.dtend_utc}`}
                          className="inline-flex items-center text-xs font-semibold px-2.5 py-1 bg-secondary text-secondary-foreground border border-border/80 rounded-full"
                        >
                          {formatOccurrence(occ, t, i18n.language || "en-US")}
                        </span>
                      ))}
                    </div>
                  }
                />

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
                    <h3 className="font-semibold text-sm text-foreground mb-1">
                      {t("forms.foodProvided")}
                    </h3>
                    <FoodTagsContainer>
                      {displayedEvent.food.map((food) => (
                        <FoodTag key={food}>{translateFood(food, t)}</FoodTag>
                      ))}
                    </FoodTagsContainer>
                  </div>
                )}

                <InfoRow
                  label={t("filters.registration")}
                  value={displayedEvent.registration ? t("common.yes") : t("common.no")}
                />
                <InfoRow
                  label={t("events.status")}
                  value={displayedEvent.isLive ? t("common.live") : t("common.notLive")}
                />

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
      {displayedEvent && activeDialog === "share" && (
        <Suspense fallback={null}>
          <EventShareDialog
            event={displayedEvent}
            open
            onOpenChange={(open) => setActiveDialog(open ? "share" : null)}
          />
        </Suspense>
      )}
      {displayedEvent && activeDialog === "report" && (
        <Suspense fallback={null}>
          <EventReportDialog
            eventId={displayedEvent.id}
            eventTitle={displayedEvent.title}
            open
            onOpenChange={(open) => setActiveDialog(open ? "report" : null)}
          />
        </Suspense>
      )}
    </Dialog>
  );
}
