"use client";

import { EventsPageContainer } from "@/features/events/pages/EventsPageContainer";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";

interface EventRoutePageProps {
  initialSnapshot: PaginatedEventsResponse | null;
  initialSchool: string;
}

export function EventRoutePage(props: EventRoutePageProps) {
  return <EventsPageContainer {...props} />;
}
