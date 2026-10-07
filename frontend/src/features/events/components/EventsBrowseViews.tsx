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
  allEvents: ComponentProps<typeof EventList>["events"];
  onEventClick: NonNullable<ComponentProps<typeof EventList>["onEventClick"]>;
};

export function EventsBrowseViews({ view, school, allEvents, ...listProps }: EventsBrowseViewsProps) {
  if (view === "grid") return <EventList {...listProps} />;
  if (listProps.isLoading) return <EventViewSkeleton variant={view} />;
  if (view === "map") return <EventsMap key={school} school={school} events={listProps.events} allEvents={allEvents} onEventClick={listProps.onEventClick} />;
  return <EventsCalendar key={school} school={school} events={listProps.events} onEventClick={listProps.onEventClick} />;
}
