import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { EventList } from "@/features/events/components/EventList";
import { EventViewSkeleton } from "@/features/events/components/EventViewSurface";
import type { EventBrowseView } from "@/features/events/components/EventViewSelect";

const EventsMap = dynamic(() => import("@/features/events/components/EventsMap").then(module => module.EventsMap), { ssr: false, loading: EventViewSkeleton });
const EventsCalendar = dynamic(() => import("@/features/events/components/EventsCalendar").then(module => module.EventsCalendar), { ssr: false, loading: EventViewSkeleton });

type EventsBrowseViewsProps = ComponentProps<typeof EventList> & {
  view: EventBrowseView;
  school: string;
  onEventClick: NonNullable<ComponentProps<typeof EventList>["onEventClick"]>;
};

export function EventsBrowseViews({ view, school, ...listProps }: EventsBrowseViewsProps) {
  if (view === "grid" || listProps.isLoading || listProps.events.length === 0) return <EventList {...listProps} />;
  if (view === "map") return <EventsMap key={school} school={school} events={listProps.events} onEventClick={listProps.onEventClick} />;
  return <EventsCalendar key={school} school={school} events={listProps.events} onEventClick={listProps.onEventClick} />;
}
