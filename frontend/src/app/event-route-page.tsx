"use client";

import { useLayoutEffect } from "react";
import { AppPage } from "@/app/app-page";
import { useAppReady } from "@/app/client-providers";
import { EventsPageContainer } from "@/features/events/pages/EventsPageContainer";
import { useEventsStore } from "@/features/events/store/events.store";
import { resolveSchool } from "@/shared/constants/schools";
import i18n from "@/shared/lib/i18n";
import type { SchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";

interface EventRoutePageProps {
  initialSnapshot: SchoolBrowseSnapshot | null;
  initialSchool: string;
}

export function EventRoutePage({ initialSnapshot, initialSchool }: EventRoutePageProps) {
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
    return null;
  }

  return (
    <AppPage>
      <EventsPageContainer />
    </AppPage>
  );
}
