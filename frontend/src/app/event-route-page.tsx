"use client";

import { EventsPageContainer } from "@/features/events/pages/EventsPageContainer";
import type { EventFeedFirstScreen } from "@/features/events/lib/eventFeedFirstScreen";

interface EventRoutePageProps {
  firstScreen: EventFeedFirstScreen | null;
  initialSchool: string;
}

export function EventRoutePage(props: EventRoutePageProps) {
  return <EventsPageContainer {...props} />;
}
