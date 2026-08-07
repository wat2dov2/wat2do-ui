import type { Event } from "@/shared/types";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { orderOrganizationEvents } from "@/features/events/lib/organizationEventOrder";
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

/** Public event detail shared by route metadata, initial HTML, and hydration. */
export async function getEventDetailSnapshot(eventId: number): Promise<Event | null> {
  const response = await fetch(
    `${getServerApiBaseUrl()}/events/${encodeURIComponent(String(eventId))}`,
    {
      next: {
        revalidate:
          process.env.NODE_ENV === "development"
            ? 0
            : controlBox.eventDiscovery.feedRevalidateSeconds,
      },
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Event detail request failed with status ${response.status}`);
  }

  return (await response.json()) as Event;
}

async function fetchEventsPage(
  school: string,
  page: number,
  fetchOptions: RequestInit,
  options: { organizationId?: number; includePast?: boolean } = {},
): Promise<PaginatedEventsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(controlBox.eventDiscovery.serverFeedPageSize),
    school,
  });
  if (options.organizationId != null) {
    params.set("organization_ids", String(options.organizationId));
  }
  if (options.includePast) {
    params.set("include_past", "true");
  }
  const response = await fetch(`${getServerApiBaseUrl()}/events/?${params.toString()}`, fetchOptions);

  if (!response.ok) {
    throw new Error(`Event feed request failed with status ${response.status}`);
  }

  return (await response.json()) as PaginatedEventsResponse;
}

/** Every event for one organization, including history, for its public page. */
export async function getOrganizationEventsSnapshot(
  organizationId: number,
  school: string,
): Promise<Event[]> {
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
  const options = { organizationId, includePast: true };
  const firstPage = await fetchEventsPage(
    resolvedSchool,
    1,
    fetchOptions,
    options,
  );
  const remainingPages = await Promise.all(
    Array.from(
      { length: Math.max(firstPage.total_pages - 1, 0) },
      (_, index) =>
        fetchEventsPage(
          resolvedSchool,
          index + 2,
          fetchOptions,
          options,
        ),
    ),
  );

  return orderOrganizationEvents(
    [firstPage, ...remainingPages].flatMap((page) => page.items),
    Date.now(),
  );
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
