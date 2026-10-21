"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRequestSchool } from "@/app/client-providers";
import { EventsBrowseViews } from "@/features/events";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import type { Event } from "@/shared/types";
import { cn } from "@/shared/lib/utils";

/** The grid shows a sample of the feed; the map and calendar show all of it. */
const GRID_EVENT_COUNT = 10;

export type LandingEventView = "grid" | "map" | "calendar";

interface LandingEventViewsProps {
  view: LandingEventView;
  events: Event[];
  isLoading: boolean;
}

/** The real feed views of this school's events, sized for a scrolling page. */
export function LandingEventViews({ view, events, isLoading }: LandingEventViewsProps) {
  const router = useRouter();
  const school = useRequestSchool();
  const openEvent = useCallback((event: Event) => router.push(eventPagePath(event.id)), [router]);

  return (
    // The map fills its container, so it needs one with a height of its own.
    <div className={cn("flex w-full flex-col", view === "map" && "h-[26rem] sm:h-[34rem]")}>
      <EventsBrowseViews
        view={view}
        school={school}
        events={view === "grid" ? events.slice(0, GRID_EVENT_COUNT) : events}
        eventStats={null}
        isLoading={isLoading}
        onEventClick={openEvent}
        groupByDateSections={false}
        embedded
      />
    </div>
  );
}
