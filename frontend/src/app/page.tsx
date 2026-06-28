import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { EventRoutePage } from "@/app/event-route-page";
import { StaticEventFeed } from "@/features/events/components/StaticEventFeed";
import { getEventFeedForSchool } from "@/features/events/api/eventFeed.server";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";

export const revalidate = 3600;

async function loadInitialFeed(school: string): Promise<PaginatedEventsResponse | null> {
  try {
    return await getEventFeedForSchool(school);
  } catch (err) {
    console.error("Initial event feed fetch failed:", err);
    return null;
  }
}

export default async function HomePage() {
  const feed = await loadInitialFeed(DEFAULT_SCHOOL);

  return (
    <>
      {feed ? <StaticEventFeed feed={feed} school={DEFAULT_SCHOOL} /> : null}
      <EventRoutePage initialFeed={feed} initialSchool={DEFAULT_SCHOOL} />
    </>
  );
}
