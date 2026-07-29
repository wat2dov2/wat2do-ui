import type { Event } from "@/shared/types";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { getServerApiBaseUrl } from "@/shared/services/serverApi";

export interface SchoolBrowseSnapshot {
  feed: PaginatedEventsResponse;
  promotedEvents: Event[];
}

export function eventFeedTag(school: string): string {
  return `event-feed-${resolveSchool(school)}`;
}

async function fetchEventsPage(
  school: string,
  page: number,
  fetchOptions: RequestInit,
): Promise<PaginatedEventsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(controlBox.eventDiscovery.serverFeedPageSize),
    school,
  });
  const response = await fetch(`${getServerApiBaseUrl()}/events/?${params.toString()}`, fetchOptions);

  if (!response.ok) {
    throw new Error(`Event feed request failed with status ${response.status}`);
  }

  return (await response.json()) as PaginatedEventsResponse;
}

async function fetchPromotedEvents(
  school: string,
  fetchOptions: RequestInit,
): Promise<Event[]> {
  const params = new URLSearchParams({ school });
  const response = await fetch(
    `${getServerApiBaseUrl()}/events/promoted?${params.toString()}`,
    fetchOptions,
  );

  if (!response.ok) {
    throw new Error(`Promoted events request failed with status ${response.status}`);
  }

  return (await response.json()) as Event[];
}

export async function getSchoolBrowseSnapshot(school: string): Promise<SchoolBrowseSnapshot> {
  const resolvedSchool = resolveSchool(school);
  const fetchOptions: RequestInit = {
    next: {
      revalidate:
        process.env.NODE_ENV === "development"
          ? 0
          : controlBox.eventDiscovery.feedRevalidateSeconds,
      tags: [eventFeedTag(resolvedSchool)],
    },
  };

  const firstPage = await fetchEventsPage(resolvedSchool, 1, fetchOptions);
  const allItems = [...firstPage.items];

  for (let page = 2; page <= firstPage.total_pages; page += 1) {
    const nextPage = await fetchEventsPage(resolvedSchool, page, fetchOptions);
    allItems.push(...nextPage.items);
  }

  const feed: PaginatedEventsResponse = {
    items: allItems,
    total: firstPage.total,
    page: 1,
    page_size: allItems.length || controlBox.eventDiscovery.serverFeedPageSize,
    total_pages: 1,
    latest_added_event: firstPage.latest_added_event ?? null,
  };

  const promotedEvents = await fetchPromotedEvents(resolvedSchool, fetchOptions);

  return { feed, promotedEvents };
}
