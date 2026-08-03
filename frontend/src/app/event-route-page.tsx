"use client";

import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppPage } from "@/app/app-page";
import { useAppReady } from "@/app/client-providers";
import { EventCard } from "@/features/events/components/EventCard";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { EventsPageContainer } from "@/features/events/pages/EventsPageContainer";
import { useEventsStore } from "@/features/events/store/events.store";
import { resolveSchool } from "@/shared/constants/schools";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { Stack } from "@/shared/layout";
import { controlBox } from "@/shared/config/controlBox";
import i18n from "@/shared/lib/i18n";
import type { SchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";

interface EventRoutePageProps {
  initialSnapshot: SchoolBrowseSnapshot | null;
  initialSchool: string;
}

function InitialEventFeed({
  initialSnapshot,
}: Pick<EventRoutePageProps, "initialSnapshot">) {
  const { t } = useTranslation();
  const events = (initialSnapshot?.feed.items ?? []).slice(
    0,
    controlBox.eventDiscovery.initialRenderCount,
  );

  return (
    <Stack gap={6}>
      <main aria-label={t("search.ariaLabel")}>
        {events.length > 0 ? (
          <div className={CARD_GRID_CLASS}>
            {events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                interactive={false}
                titleHref={eventPagePath(event.id)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("events.noEventsScheduledDesc")}
          </p>
        )}
      </main>
    </Stack>
  );
}

export function EventRoutePage({
  initialSnapshot,
  initialSchool,
}: EventRoutePageProps) {
  const ready = useAppReady();

  useLayoutEffect(() => {
    if (!ready) return;

    if (initialSnapshot) {
      useEventsStore
        .getState()
        .hydrateInitialFeed(
          initialSnapshot.feed,
          initialSchool,
          initialSnapshot.promotedEvents,
        );
      return;
    }

    useEventsStore.setState({
      schoolFilter: resolveSchool(initialSchool),
      isLoading: false,
      error: i18n.t("events.loadFailed"),
    });
  }, [initialSnapshot, initialSchool, ready]);

  if (!ready) {
    return (
      <AppPage renderBeforeReady>
        <InitialEventFeed initialSnapshot={initialSnapshot} />
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EventsPageContainer />
    </AppPage>
  );
}
