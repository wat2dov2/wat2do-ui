import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { EventList } from "@/features/events/components/EventList";
import { EventViewSkeleton } from "@/features/events/components/EventViewSurface";
import type { EventBrowseView } from "@/features/events/components/EventViewSelect";

const EventsMap = dynamic(() => import("@/features/events/components/EventsMap").then(module => module.EventsMap), { ssr: false, loading: () => <EventViewSkeleton variant="map" /> });
const EventsCalendar = dynamic(() => import("@/features/events/components/EventsCalendar").then(module => module.EventsCalendar), { ssr: false, loading: () => <EventViewSkeleton /> });

type EventsBrowseViewsProps = ComponentProps<typeof EventList> & {
  view: EventBrowseView;
  school: string;
  onEventClick: NonNullable<ComponentProps<typeof EventList>["onEventClick"]>;
};

/** The events page's map view: most of the screen, so the page still scrolls to what sits above it. */
export const EVENT_MAP_VIEW_CLASS = "h-[75dvh] min-h-96";

export function EventsBrowseViews({ view, school, ...listProps }: EventsBrowseViewsProps) {
  if (view === "grid") return <EventList {...listProps} />;
  // The map and calendar show every event, so they wait while the list holds only its start.
  if (listProps.isLoading || listProps.totalCount !== undefined) {
    return <EventViewSkeleton variant={view}>{listProps.loadFailureNotice}</EventViewSkeleton>;
  }
  if (view === "map") return <EventsMap key={school} school={school} events={listProps.events} onEventClick={listProps.onEventClick} />;
  return <EventsCalendar key={school} school={school} events={listProps.events} onEventClick={listProps.onEventClick} />;
}
