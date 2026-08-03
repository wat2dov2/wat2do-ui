import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { tracker } from "@/shared/services/trackingService";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { Separator } from "@/shared/ui/separator";
import { EventDetailsDrawerSkeleton } from "@/features/events/components/EventDetailsDrawerSkeleton";
import {
  EventActions,
  EventDetailsBody,
  EventDetailsSimilarEvents,
} from "@/features/events/components/EventDetailsSections";
import { DrawerBody, Stack } from "@/shared/layout";
import { useEventsStore } from "@/features/events/store/events.store";
import { fetchEventById } from "@/features/events/api/events.api";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { Event } from "@/shared/types";

interface EventDetailsModalProps {
  eventId?: number | null;
  event: Event | null;
  onClose: () => void;
  allEvents?: Event[];
  /** When true, the Similar Events section is hidden (e.g. in admin panel). */
  hideSimilarEvents?: boolean;
}

export function EventDetailsModal({
  eventId = null,
  event,
  onClose,
  allEvents,
  hideSimilarEvents = false,
}: EventDetailsModalProps) {
  const { t } = useTranslation();
  const storeEvents = useEventsStore((s) => s.events);
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const [overrideEvent, setOverrideEvent] = useState<Event | null>(null);
  const [overrideForEventId, setOverrideForEventId] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resolvedEventId = eventId ?? event?.id ?? null;
  const listEvent = event;
  const activeOverride =
    overrideEvent && overrideForEventId === resolvedEventId ? overrideEvent : null;

  // The summary (list/card) payload omits large text like description; only the
  // detail endpoint carries it. `baseEvent` renders instantly for a snappy open;
  // the detail fetch below fills in the missing fields once it resolves.
  const baseEvent = activeOverride ?? listEvent ?? null;
  const detailEventId = baseEvent?.id ?? resolvedEventId;

  const { data: fetchedEvent, isPending: isFetchingEvent, isError: isFetchError } = useQuery({
    queryKey: queryKeys.events.detail(detailEventId ?? 0),
    queryFn: () => fetchEventById(detailEventId!),
    enabled: detailEventId != null,
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });

  // Detail is authoritative and complete; org link fields it omits survive the
  // spread because they are absent keys on the detail payload.
  const displayedEvent = useMemo(() => {
    const detailForBase =
      fetchedEvent && fetchedEvent.id === baseEvent?.id ? fetchedEvent : null;
    return baseEvent ? { ...baseEvent, ...detailForBase } : fetchedEvent ?? null;
  }, [baseEvent, fetchedEvent]);
  const drawerOpen = resolvedEventId !== null;
  if (!drawerOpen && (overrideEvent !== null || overrideForEventId !== null)) {
    setOverrideEvent(null);
    setOverrideForEventId(null);
  }
  const showSkeleton =
    drawerOpen && displayedEvent == null && !isFetchError && isFetchingEvent;

  useEffect(() => {
    if (displayedEvent) {
      tracker.track(displayedEvent.id, "detail_view");
    }
  }, [displayedEvent]);

  const handleSimilarEventClick = useCallback((clickedEvent: Event) => {
    setOverrideEvent(clickedEvent);
    setOverrideForEventId(resolvedEventId);
    contentRef.current
      ?.querySelector<HTMLElement>("[data-slot='drawer-body']")
      ?.scrollTo({ top: 0, behavior: "smooth" });
  }, [resolvedEventId]);

  const handleDrawerOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Drawer open={drawerOpen} onOpenChange={handleDrawerOpenChange}>
      <DrawerContent className="overflow-hidden p-0 [&_[data-slot=drawer-handle]]:hidden data-[vaul-drawer-direction=bottom]:max-w-screen-lg">
        <div
          ref={contentRef}
          className="flex min-h-0 flex-1 flex-col"
        >
          {showSkeleton ? (
            <>
              <DrawerTitle className="sr-only">{t("common.loading")}</DrawerTitle>
              <EventDetailsDrawerSkeleton />
            </>
          ) : displayedEvent ? (
            <>
              <DrawerHeader className="text-left">
                <Stack
                  direction="horizontal"
                  justify="end"
                  align="center"
                  gap={3}
                  wrap
                >
                  <EventActions event={displayedEvent} onBeforeEdit={onClose} />
                </Stack>
              </DrawerHeader>

              <Separator />

              <DrawerBody>
                <DrawerDescription className="sr-only">
                  {t("events.hostedBy")} {displayedEvent.organization}
                </DrawerDescription>

                <EventDetailsBody
                  event={displayedEvent}
                  school={schoolFilter}
                  isFetchingDetails={isFetchingEvent}
                  renderTitle={(title) => (
                    <DrawerTitle className="text-left text-2xl font-bold leading-tight sm:text-3xl">
                      {title}
                    </DrawerTitle>
                  )}
                />

                {!hideSimilarEvents && (
                  <EventDetailsSimilarEvents
                    event={displayedEvent}
                    events={allEvents ?? storeEvents}
                    onEventClick={handleSimilarEventClick}
                  />
                )}
              </DrawerBody>
            </>
          ) : isFetchError ? (
            <DrawerBody className="text-center text-sm text-muted-foreground">
              <DrawerTitle className="sr-only">{t("common.error")}</DrawerTitle>
              <p>{t("common.error")}</p>
            </DrawerBody>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
