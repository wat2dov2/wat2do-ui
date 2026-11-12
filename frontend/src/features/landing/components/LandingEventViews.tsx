"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRequestSchool } from "@/app/client-providers";
import { EventsBrowseViews, eventFeedQueryOptions, useCurrentTime } from "@/features/events";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { useWhenIdle } from "@/shared/hooks/useWhenIdle";
import type { Event } from "@/shared/types";
import { cn } from "@/shared/lib/utils";
import { hasActiveEventOccurrence } from "@/shared/utils/date";

/** The grid shows a sample of the feed; the map and calendar show all of it. */
const GRID_EVENT_COUNT = 10;
/** How far below the screen the views start loading the feed (and the map its code). */
const VIEWS_LOAD_MARGIN = "400px";
/** The longest the views wait for an idle moment once they are near. */
const VIEWS_IDLE_TIMEOUT_MS = 2000;

export type LandingEventView = "grid" | "map" | "calendar";

/**
 * The real feed views of this school's events, sized for a scrolling page.
 * The school's whole feed loads only as they come near, unless an earlier
 * page already has it, so the landing page's HTML never carries every event
 * and the map's code waits until it is about to show.
 */
export function LandingEventViews({ view }: { view: LandingEventView }) {
  const router = useRouter();
  const school = useRequestSchool();
  const { ref, hasIntersected: near } = useIntersectionObserver<HTMLDivElement>({ rootMargin: VIEWS_LOAD_MARGIN });
  // They also wait for an idle moment, so the map's code and tiles never hold up the hero above them.
  const ready = useWhenIdle(near, VIEWS_IDLE_TIMEOUT_MS);
  const { data: feed, isError } = useQuery({ ...eventFeedQueryOptions(school), enabled: ready });
  const currentTimeMs = useCurrentTime();
  const events = useMemo(
    () => (currentTimeMs === null ? [] : (feed?.items ?? []).filter((event) => hasActiveEventOccurrence(event, currentTimeMs))),
    [currentTimeMs, feed],
  );
  const openEvent = useCallback((event: Event) => router.push(eventPagePath(event.id)), [router]);

  return (
    // The map runs edge to edge under the card's notches and fills a height of its own; the
    // grid and calendar keep clear of the notched badges above and below them.
    <div ref={ref} className={cn("flex w-full flex-col", view === "map" ? "h-[26rem] sm:h-[34rem]" : "px-3 py-14 sm:px-4")}>
      <EventsBrowseViews
        view={view}
        school={school}
        events={view === "grid" ? events.slice(0, GRID_EVENT_COUNT) : events}
        eventStats={null}
        // A feed that cannot be read leaves the views empty rather than loading forever.
        isLoading={(!feed && !isError) || currentTimeMs === null}
        onEventClick={openEvent}
        groupByDateSections={false}
      />
    </div>
  );
}
