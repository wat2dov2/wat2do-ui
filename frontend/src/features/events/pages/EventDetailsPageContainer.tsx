"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { LoadingPage } from "@/shared/ui/loading-page";
import {
  EventActions,
  EventDetailsBody,
  EventDetailsSimilarEvents,
} from "@/features/events/components/EventDetailsSections";
import {
  fetchEventById,
  fetchEventFeed,
} from "@/features/events/api/events.api";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { useEventsStore } from "@/features/events/store/events.store";
import { controlBox } from "@/shared/config/controlBox";
import { ROUTES } from "@/shared/constants/routes";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Container, PageHeader, Stack } from "@/shared/layout";
import type { Event } from "@/shared/types";

interface EventDetailsPageContainerProps {
  eventId: number;
  initialEvent: Event;
}

/** Dedicated /events/[id] page: poster + hosts on the left, details on the right. */
export function EventDetailsPageContainer({
  eventId,
  initialEvent,
}: EventDetailsPageContainerProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const storeEvents = useEventsStore((state) => state.events);
  const { data: event, isPending, isError } = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEventById(eventId),
    enabled: Number.isFinite(eventId),
    initialData: initialEvent,
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  const storeEventsForSchool = useMemo(
    () =>
      event
        ? storeEvents.filter((candidate) => candidate.school === event.school)
        : [],
    [event, storeEvents],
  );
  const hasStoreSimilarEvents = storeEventsForSchool.some(
    (candidate) => candidate.id !== event?.id,
  );
  const { data: fetchedSchoolEvents = [] } = useQuery({
    queryKey: queryKeys.events.bySchool(event?.school ?? ""),
    queryFn: () => fetchEventFeed(event!.school),
    enabled: Boolean(event?.school) && !hasStoreSimilarEvents,
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  const similarEventCandidates =
    hasStoreSimilarEvents
      ? storeEventsForSchool
      : fetchedSchoolEvents;
  const handleSimilarEventClick = useCallback(
    (similarEvent: Event) => {
      router.push(eventPagePath(similarEvent.id));
    },
    [router],
  );

  if (isPending && !isError) {
    return <LoadingPage className="min-h-[60dvh]" />;
  }

  if (isError || !event) {
    return (
      <Container size="lg">
        <p className="text-center text-sm text-muted-foreground">
          {t("common.error")}
        </p>
      </Container>
    );
  }

  return (
    <Container size="lg">
      <Stack gap={6}>
        <PageHeader
          back={{
            href: ROUTES.HOME,
            label: t("events.allEvents"),
          }}
          actions={<EventActions event={event} />}
        />
        <EventDetailsBody event={event} school={event.school} />
        <EventDetailsSimilarEvents
          event={event}
          events={similarEventCandidates}
          onEventClick={handleSimilarEventClick}
        />
      </Stack>
    </Container>
  );
}
