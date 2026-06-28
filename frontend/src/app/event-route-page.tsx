"use client";

import { useLayoutEffect } from "react";
import { AppPage } from "@/app/app-page";
import { useAppReady } from "@/app/client-providers";
import { EventsPageContainer } from "@/features/events/pages/EventsPageContainer";
import { useEventsStore } from "@/features/events/store/events.store";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";

interface EventRoutePageProps {
  initialFeed: PaginatedEventsResponse | null;
  initialSchool: string;
}

export function EventRoutePage({ initialFeed, initialSchool }: EventRoutePageProps) {
  const ready = useAppReady();

  useLayoutEffect(() => {
    if (!ready) return;

    if (initialFeed) {
      useEventsStore.getState().hydrateInitialFeed(initialFeed, initialSchool);
    } else {
      useEventsStore.getState().setSchoolFilter(initialSchool);
    }
  }, [initialFeed, initialSchool, ready]);

  if (!ready) {
    return null;
  }

  return (
    <AppPage>
      <EventsPageContainer />
    </AppPage>
  );
}
