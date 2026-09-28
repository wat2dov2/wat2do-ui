"use client";

import { useCallback } from "react";
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
  eventFeedQueryOptions,
} from "@/features/events/api/events.api";
import { eventPagePath } from "@/features/events/lib/eventUrls";
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
  const { data: event, isPending } = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEventById(eventId),
    enabled: Number.isFinite(eventId),
    initialData: initialEvent,
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  const { data: schoolFeed } = useQuery({
    ...eventFeedQueryOptions(event?.school ?? ""),
    enabled: Boolean(event?.school),
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
            href: ROUTES.HOME,
            label: t("events.allEvents"),
          }}
          actions={event ? <EventActions event={event} /> : undefined}
        />
        {event ? (
          <>
            <EventDetailsBody event={event} school={event.school} />
            <EventDetailsSimilarEvents
              event={event}
              events={schoolFeed?.items ?? []}
              onEventClick={handleSimilarEventClick}
            />
          </>
        ) : isPending ? (
          <LoadingPage variant="detail" />
        ) : (
          <p role="alert">{t("common.error")}</p>
        )}
      </Stack>
    </Container>
  );
}
