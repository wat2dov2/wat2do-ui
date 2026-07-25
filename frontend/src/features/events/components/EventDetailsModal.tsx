import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { tracker } from "@/shared/services/trackingService";
import { ArrowRight } from "@/shared/ui/doodle-icons";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";
import { EventDetailsDrawerSkeleton } from "@/features/events/components/EventDetailsDrawerSkeleton";
import { EventCard } from "@/features/events/components/EventCard";
import {
  EventActions,
  EventDetailsBody,
  EventStatusBadges,
} from "@/features/events/components/EventDetailsSections";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { DrawerBody, FormGrid, Section, Stack } from "@/shared/layout";
import { useEventsStore } from "@/features/events/store/events.store";
import { useEventStats } from "@/features/events/hooks/useEventStats";
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
  const { data: eventStatsData, isSuccess: eventStatsReady } = useEventStats(schoolFilter);
  const eventStats = eventStatsReady ? (eventStatsData ?? {}) : null;
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
          className="max-h-[inherit] overflow-y-auto"
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
                  <Stack direction="horizontal" gap={2} wrap>
                    <Button asChild variant="secondary" size="sm">
                      <a
                        href={eventPagePath(displayedEvent.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("events.eventPage")}
                        <ArrowRight className="size-4 -rotate-45" />
                      </a>
                    </Button>
                    <EventActions event={displayedEvent} />
                  </Stack>
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
                  showActions={false}
                  renderTitle={(title) => (
                    <Stack gap={2}>
                      <EventStatusBadges event={displayedEvent} />
                      <DrawerTitle className="text-left text-2xl font-bold leading-tight sm:text-3xl">
                        {title}
                      </DrawerTitle>
                    </Stack>
                  )}
                />

                {!hideSimilarEvents && similarEvents.length > 0 && (
                  <>
                    <Separator />
                    <Section title={t("events.similarEvents")}>
                      <FormGrid columns={2} className="md:grid-cols-4">
                        {similarEvents.map((similarEvent) => (
                          <EventCard
                            key={similarEvent.id}
                            event={similarEvent}
                            stats={eventStats?.[String(similarEvent.id)]}
                            onEventClick={handleSimilarEventClick}
                          />
                        ))}
                      </FormGrid>
                    </Section>
                  </>
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
