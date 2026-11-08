"use client";

import { EventsPageContainer } from "@/features/events/pages/EventsPageContainer";
import type { EventFeedFirstScreen } from "@/features/events/lib/eventFeedFirstScreen";
import type { Position } from "@/shared/types";

interface EventRoutePageProps {
  firstScreen: EventFeedFirstScreen | null;
  openPositions: Position[] | null;
  initialSchool: string;
}

export function EventRoutePage(props: EventRoutePageProps) {
  return <EventsPageContainer {...props} />;
}
