import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { tracker } from "@/shared/services/trackingService";
import { LoadingPage } from "@/shared/ui/loading-page";
import {
  EventActions,
  EventDetailsBody,
} from "@/features/events/components/EventDetailsSections";
import { fetchEventById } from "@/features/events/api/events.api";
import { controlBox } from "@/shared/config/controlBox";
import { ROUTES } from "@/shared/constants/routes";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Container, PageHeader, Stack } from "@/shared/layout";

interface EventDetailsPageContainerProps {
  eventId: number;
}

/** Dedicated /events/[id] page: poster + hosts on the left, details on the right. */
export function EventDetailsPageContainer({ eventId }: EventDetailsPageContainerProps) {
  const { t } = useTranslation();
  const { data: event, isPending, isError } = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEventById(eventId),
    enabled: Number.isFinite(eventId),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });

  useEffect(() => {
    if (event) {
      tracker.track(event.id, "detail_view");
    }
  }, [event]);

  if (isPending && !isError) {
    return <LoadingPage className="min-h-[60dvh]" />;
  }

  if (isError || !event) {
    return (
      <div className="px-4 py-16 text-center text-sm text-muted-foreground">
        <p>{t("common.error")}</p>
      </div>
    );
  }

  return (
    <Container size="lg" className="max-w-5xl py-6 sm:py-8">
      <Stack gap={6}>
        <PageHeader
          back={{
            href: ROUTES.HOME,
            label: t("events.allEvents"),
          }}
          actions={<EventActions event={event} />}
        />
        <EventDetailsBody
          event={event}
          school={event.school}
          showActions={false}
        />
      </Stack>
    </Container>
  );
}
