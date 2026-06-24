import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef, type PointerEvent } from "react";
import { animate, m, useDragControls, useMotionValue, type PanInfo } from "framer-motion";
import { useTranslation } from "react-i18next";
import { tracker } from "@/shared/services/trackingService";
import { sanitizeHref } from "@/shared/utils/url";
import { formatOccurrence } from "@/shared/utils/date";
import { downloadICS, openGoogleCalendar } from "@/shared/utils/generateICS";
import { ImageOff, ExternalLink, Heart, Share2, Download, Flag, X } from "@/shared/ui/doodle-icons";
import { AppleIcon, GoogleIcon } from "@/shared/ui/platform-icons";
import {
  Dialog,
  DialogClose,
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
import { EventCard, type EventCardDialog } from "@/features/events/components/EventCard";
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
type EventDetailsDialog = Exclude<EventCardDialog, "delete">;

interface ActiveEventDetailsDialog {
  type: EventDetailsDialog;
  event: Event;
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
  const [activeDialog, setActiveDialog] = useState<ActiveEventDetailsDialog | null>(null);
  const dragControls = useDragControls();
  const dragY = useMotionValue(0);
  const contentRef = useRef<HTMLDivElement>(null);
  if ((event?.id ?? null) !== trackedPropEventId) {
    setTrackedPropEventId(event?.id ?? null);
    setOverrideEvent(null);
  }
  const displayedEvent = overrideEvent ?? event;

  const isOpen = event !== null;
  const isSaved = displayedEvent ? savedEventIds.includes(displayedEvent.id) : false;
  const isSaveActive = profileCompleted && isSaved;

  // Track detail_view on open, dwell time on close
  const openTimeRef = useRef<number>(0);
  useEffect(() => {
    if (isOpen) {
      dragY.set(0);
    }
  }, [dragY, isOpen]);

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
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleDragPointerDown = useCallback(
    (pointerEvent: PointerEvent<HTMLDivElement>) => {
      if (pointerEvent.button !== 0) return;
      dragControls.start(pointerEvent);
    },
    [dragControls],
  );

  const handleDragEnd = useCallback(
    (_event: unknown, info: PanInfo) => {
      const offsetY = Math.max(0, info.offset.y);
      if (offsetY >= DRAG_CLOSE_THRESHOLD_PX || info.velocity.y > 700) {
        onClose();
        return;
      }
      void animate(dragY, 0, {
        type: "spring",
        stiffness: 520,
        damping: 42,
      });
    },
    [dragY, onClose],
  );

  const handleActionDialogOpen = useCallback((type: EventCardDialog, targetEvent: Event) => {
    if (type === "delete") return;
    setActiveDialog({ type, event: targetEvent });
  }, []);

  const handleActionDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setActiveDialog(null);
    }
  }, []);

  const modalState = useModalState({ onClose });

  return (
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent
        asChild
        showCloseButton={false}
        className="w-[calc(100vw-16px)] max-w-3xl overflow-hidden p-0 sm:w-[calc(100vw-48px)]"
      >
        <m.div
          ref={contentRef}
          className="max-h-[90dvh] overflow-y-auto border-0 p-0"
          style={{ y: dragY }}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 240 }}
          dragElastic={{ top: 0, bottom: 0.22 }}
          dragMomentum={false}
          onDragEnd={handleDragEnd}
        >
        {displayedEvent && (
          <>
            <DialogClose asChild>
              <button
                type="button"
                className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl bg-background/90 text-foreground opacity-80 shadow-sm transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label={t("common.close")}
              >
                <X className="size-4" />
              </button>
            </DialogClose>
            <div
              className="relative h-64 w-full touch-none select-none overflow-hidden cursor-grab active:cursor-grabbing sm:h-80"
              data-event-details-drag-handle
              onPointerDown={handleDragPointerDown}
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

            <ModalContentWrapper className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
              <DialogHeader className="text-left">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <DialogTitle className="leading-tight">{displayedEvent.title}</DialogTitle>
                    <DialogDescription>{displayedEvent.organization}</DialogDescription>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <Button
                      type="button"
                      variant={isSaveActive ? "secondary" : "outline"}
                      size="icon-sm"
                      disabled={!profileCompleted}
                      onMouseDown={() => toggleSaveEvent(displayedEvent.id)}
                      aria-label={isSaveActive ? t("common.saved") : t("common.imInterested")}
                      title={isSaveActive ? t("common.saved") : t("common.imInterested")}
                      className={
                        !profileCompleted
                          ? "border-border bg-muted/40 text-muted-foreground opacity-60 saturate-0 hover:bg-muted/40"
                          : isSaveActive
                            ? "border-error/20 bg-error/10 text-error hover:bg-error/15"
                            : ""
                      }
                    >
                      <Heart className={`size-4 ${isSaveActive ? "fill-current" : ""}`} />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onMouseDown={() => setActiveDialog({ type: "share", event: displayedEvent })}
                      aria-label={t("common.share")}
                      title={t("common.share")}
                    >
                      <Share2 className="size-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={t("common.export")}
                          title={t("common.export")}
                        >
                          <Download className="size-4" />
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
                      size="icon-sm"
                      onMouseDown={() => setActiveDialog({ type: "report", event: displayedEvent })}
                      aria-label={t("common.report")}
                      title={t("common.report")}
                    >
                      <Flag className="size-4" />
                    </Button>
                  </div>
                </div>
              </DialogHeader>

              <ModalSection className="space-y-3">
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
                    <div className="mt-1 flex flex-wrap gap-1.5">
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
                  <InfoSection className="mt-3 space-y-3 pt-3">
                    <SectionTitle className="mb-3">{t("events.similarEvents")}</SectionTitle>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {similarEvents.map((similarEvent) => (
                        <EventCard
                          key={similarEvent.id}
                          event={similarEvent}
                          onEventClick={handleSimilarEventClick}
                          disableModal={true}
                          onActionDialogOpen={handleActionDialogOpen}
                        />
                      ))}
                    </div>
                  </InfoSection>
                )}
              </ModalSection>
            </ModalContentWrapper>
          </>
        )}
        </m.div>
      </DialogContent>
      {activeDialog?.type === "share" && (
        <Suspense fallback={null}>
          <EventShareDialog
            event={activeDialog.event}
            open
            onOpenChange={handleActionDialogOpenChange}
          />
        </Suspense>
      )}
      {activeDialog?.type === "report" && (
        <Suspense fallback={null}>
          <EventReportDialog
            eventId={activeDialog.event.id}
            eventTitle={activeDialog.event.title}
            open
            onOpenChange={handleActionDialogOpenChange}
          />
        </Suspense>
      )}
    </Dialog>
  );
}
