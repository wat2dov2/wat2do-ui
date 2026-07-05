import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { tracker } from "@/shared/services/trackingService";
import { sanitizeHref } from "@/shared/utils/url";
import { formatOccurrence } from "@/shared/utils/date";
import { Calendar, ImageOff, ExternalLink, Bookmark, MoreHorizontal, X } from "@/shared/ui/doodle-icons";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { EventCalendarDownloadMenu } from "@/features/events/components/EventCalendarDownloadMenu";
import { EventOverflowMenu } from "@/features/events/components/EventOverflowMenu";
import { OrganizationVerifiedBadge } from "@/features/events/components/OrganizationVerifiedBadge";
import { EventDetailsDrawerSkeleton } from "@/features/events/components/EventDetailsDrawerSkeleton";
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
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { useProfileCompleted } from "@/features/auth/hooks/useAuthState";
import { fetchEventById } from "@/features/events/api/events.api";
import { queryKeys } from "@/shared/lib/queryKeys";
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

type EventDetailsDialog = Exclude<EventCardDialog, "delete">;

interface ActiveEventDetailsDialog {
  type: EventDetailsDialog;
  event: Event;
}

interface EventDetailsModalProps {
  eventId?: number | null;
  eventOpenNonce?: number;
  event: Event | null;
  onClose: () => void;
  allEvents?: Event[];
  /** When true, the Similar Events section is hidden (e.g. in admin panel). */
  hideSimilarEvents?: boolean;
}

export function EventDetailsModal({
  eventId = null,
  eventOpenNonce = 0,
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
  const [overrideForEventId, setOverrideForEventId] = useState<number | null>(null);
  const [closedAtOpenNonce, setClosedAtOpenNonce] = useState(0);
  const [activeDialog, setActiveDialog] = useState<ActiveEventDetailsDialog | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resolvedEventId = eventId ?? event?.id ?? null;
  const listEvent = event;
  const activeOverride =
    overrideEvent && overrideForEventId === resolvedEventId ? overrideEvent : null;

  const { data: fetchedEvent, isPending: isFetchingEvent, isError: isFetchError } = useQuery({
    queryKey: queryKeys.events.detail(resolvedEventId ?? 0),
    queryFn: () => fetchEventById(resolvedEventId!),
    enabled: resolvedEventId != null && listEvent == null && activeOverride == null,
    staleTime: 60_000,
  });

  const displayedEvent = activeOverride ?? listEvent ?? fetchedEvent ?? null;
  const drawerOpen =
    resolvedEventId !== null && closedAtOpenNonce !== eventOpenNonce;
  const showSkeleton =
    drawerOpen && displayedEvent == null && !isFetchError && isFetchingEvent;
  const isSaved = displayedEvent ? savedEventIds.includes(displayedEvent.id) : false;
  const isSaveActive = profileCompleted && isSaved;

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
    setOverrideForEventId(resolvedEventId);
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [resolvedEventId]);

  const handleActionDialogOpen = useCallback((type: EventCardDialog, targetEvent: Event) => {
    if (type === "delete") return;
    setActiveDialog({ type, event: targetEvent });
  }, []);

  const handleActionDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setActiveDialog(null);
    }
  }, []);

  const handleDrawerOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setClosedAtOpenNonce(eventOpenNonce);
        onClose();
      }
    },
    [eventOpenNonce, onClose],
  );

  return (
    <Drawer open={drawerOpen} onOpenChange={handleDrawerOpenChange}>
      <DrawerContent className="overflow-hidden p-0 [&_[data-slot=drawer-handle]]:hidden">
        <div
          ref={contentRef}
          className="max-h-[92dvh] overflow-y-auto border-0 p-0"
        >
        {showSkeleton ? (
          <EventDetailsDrawerSkeleton />
        ) : displayedEvent ? (
          <>
            <DrawerClose asChild>
              <button
                type="button"
                className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl bg-background/90 text-foreground opacity-80 shadow-sm transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label={t("common.close")}
              >
                <X className="size-4" />
              </button>
            </DrawerClose>
            <div
              className="relative h-64 w-full select-none overflow-hidden sm:h-80"
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

            <ModalContentWrapper className="space-y-4 px-4 py-3 sm:px-5 sm:py-4">
              <DrawerHeader className="relative min-h-9 gap-3 p-0 pb-5 text-left sm:pb-0">
                <div className="relative flex items-start gap-3 sm:justify-center">
                  <div className="min-w-0 flex-1 text-left sm:flex-none sm:max-w-2xl sm:px-14 sm:text-center">
                    <DrawerTitle className="leading-tight text-left sm:text-center">
                      {displayedEvent.title}
                    </DrawerTitle>
                    <DrawerDescription className="mt-1 flex items-center justify-start sm:justify-center">
                      <span className="inline-flex items-center gap-0.5">
                        <span>{displayedEvent.organization}</span>
                        <OrganizationVerifiedBadge />
                      </span>
                    </DrawerDescription>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 sm:absolute sm:right-0 sm:top-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={isSaveActive ? "secondary" : "outline"}
                        size="icon-sm"
                        disabled={!profileCompleted}
                        onClick={() => toggleSaveEvent(displayedEvent.id)}
                        aria-label={isSaveActive ? t("common.saved") : t("common.imInterested")}
                        title={
                          !profileCompleted
                            ? t("events.saveRequiresLogin")
                            : isSaveActive
                              ? t("common.saved")
                              : t("common.imInterested")
                        }
                        className={
                          !profileCompleted
                            ? "border-border bg-muted/40 text-muted-foreground opacity-60 saturate-0 hover:bg-muted/40"
                            : isSaveActive
                              ? "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15"
                              : ""
                        }
                      >
                        <Bookmark className={`size-4 ${isSaveActive ? "fill-current" : ""}`} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {!profileCompleted
                          ? t("events.saveRequiresLogin")
                          : isSaveActive
                            ? t("common.saved")
                            : t("common.imInterested")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <EventCalendarDownloadMenu event={displayedEvent}>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      data-slot="dropdown-menu-trigger"
                      aria-label={t("common.addToCalendar")}
                      title={t("common.addToCalendar")}
                    >
                      <Calendar className="size-4" />
                    </Button>
                  </EventCalendarDownloadMenu>
                  <EventOverflowMenu
                    onAction={(action) => {
                      if (action === "delete") return;
                      setActiveDialog({ type: action, event: displayedEvent });
                    }}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      data-slot="dropdown-menu-trigger"
                      aria-label={t("common.moreOptions")}
                      title={t("common.moreOptions")}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </EventOverflowMenu>
                  </div>
                </div>
              </DrawerHeader>

              <ModalSection className="mt-2 space-y-3 pt-2 sm:mt-0 sm:pt-0">
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
                    <div className="grid grid-cols-2 gap-3">
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
        ) : isFetchError ? (
          <ModalContentWrapper className="px-4 py-8 text-center text-sm text-muted-foreground">
            <p>{t("common.error")}</p>
          </ModalContentWrapper>
        ) : null}
        </div>
      </DrawerContent>
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
    </Drawer>
  );
}
