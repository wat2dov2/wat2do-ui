"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { EventDetailsBodySkeleton } from "@/features/events/components/EventDetailsDrawerSkeleton";
import {
  EventActions,
  EventDetailsBody,
  EventDetailsSimilarEvents,
} from "@/features/events/components/EventDetailsSections";
import {
  fetchEventById,
  eventFeedQueryOptions,
} from "@/features/events/api/events.api";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { controlBox } from "@/shared/config/controlBox";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { ROUTES } from "@/shared/constants/routes";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Container, PageHeader, Stack } from "@/shared/layout";
import type { Event } from "@/shared/types";

/** How far below the screen "More events" starts loading its feed. */
const MORE_EVENTS_PRELOAD_MARGIN = "600px";

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
  const { data: event, isPending } = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEventById(eventId),
    enabled: Number.isFinite(eventId),
    initialData: initialEvent,
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  const { ref: moreEventsRef, hasIntersected: moreEventsNear } =
    useIntersectionObserver<HTMLSpanElement>({ rootMargin: MORE_EVENTS_PRELOAD_MARGIN });
  // The school's whole feed only fills "More events" at the bottom, so it loads
  // as that comes near, unless an earlier page already has it.
  const { data: schoolFeed } = useQuery({
    ...eventFeedQueryOptions(event?.school ?? ""),
    enabled: Boolean(event?.school) && moreEventsNear,
  });
  const handleSimilarEventClick = useCallback(
    (similarEvent: Event) => {
      router.push(eventPagePath(similarEvent.id));
    },
    [router],
  );

  return (
    <Container size="lg">
      <Stack gap={6}>
        <PageHeader
          back={{
            href: ROUTES.EVENTS,
            label: t("events.allEvents"),
          }}
          actions={event ? <EventActions event={event} /> : undefined}
        />
        {event ? (
          <>
            <EventDetailsBody event={event} school={event.school} />
            {schoolFeed ? (
              <EventDetailsSimilarEvents
                event={event}
                events={schoolFeed.items}
                onEventClick={handleSimilarEventClick}
              />
            ) : (
              <span ref={moreEventsRef} aria-hidden="true" />
            )}
          </>
        ) : isPending ? (
          <EventDetailsBodySkeleton />
        ) : (
          <p role="alert">{t("common.error")}</p>
        )}
      </Stack>
    </Container>
  );
}
