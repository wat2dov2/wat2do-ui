"use client";

import { useLayoutEffect } from "react";
import { EventsPageContainer } from "@/features/events/pages/EventsPageContainer";
import { useEventsStore } from "@/features/events/store/events.store";
import { resolveSchool } from "@/shared/constants/schools";
import i18n from "@/shared/lib/i18n";
import type { SchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";

interface EventRoutePageProps {
  initialSnapshot: SchoolBrowseSnapshot | null;
  initialSchool: string;
}

/**
 * The browse route: one page, rendered the same way from the first paint.
 *
 * The snapshot goes to the page as a prop and to the store in an effect. The
 * page reads whichever of the two is authoritative, so the server render, the
 * hydration render, and every render afterwards produce the same screen - no
 * grid-without-its-header, and no skeletons in between.
 */
export function EventRoutePage({
  initialSnapshot,
  initialSchool,
}: EventRoutePageProps) {
  useLayoutEffect(() => {
    if (initialSnapshot) {
      useEventsStore
        .getState()
        .hydrateInitialFeed(
          initialSnapshot.feed,
          initialSchool,
        );
      return;
    }

    useEventsStore.setState({
      schoolFilter: resolveSchool(initialSchool),
      isLoading: false,
      error: i18n.t("events.loadFailed"),
      hasHydratedInitialFeed: true,
    });
  }, [initialSnapshot, initialSchool]);

  return (
    <EventsPageContainer
      initialSnapshot={initialSnapshot}
      initialSchool={initialSchool}
    />
  );
}
