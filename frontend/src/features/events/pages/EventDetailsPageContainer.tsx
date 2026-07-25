import { useEffect } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { tracker } from "@/shared/services/trackingService";
import { ArrowLeft } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import {
  EventActions,
  EventDetailsBody,
  EventStatusBadges,
} from "@/features/events/components/EventDetailsSections";
import { fetchEventById } from "@/features/events/api/events.api";
import { controlBox } from "@/shared/config/controlBox";
import { ROUTES } from "@/shared/constants/routes";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Stack } from "@/shared/layout";

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
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Stack direction="horizontal" justify="between" align="start" gap={3} wrap className="mb-6">
        <Button asChild variant="secondary" size="sm">
          <Link href={ROUTES.HOME}>
            <ArrowLeft className="size-4" />
            {t("events.allEvents")}
          </Link>
        </Button>
        <EventActions event={event} />
      </Stack>
      <EventDetailsBody
        event={event}
        school={event.school}
        showActions={false}
        renderTitle={(title) => (
          <Stack gap={2}>
            <EventStatusBadges event={event} />
            <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
          </Stack>
        )}
      />
    </div>
  );
}
