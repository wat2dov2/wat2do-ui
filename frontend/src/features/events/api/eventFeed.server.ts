import { collectPaginatedPages } from "@/shared/lib/pagination";
import type { Event } from "@/shared/types";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { orderClubEvents } from "@/features/events/lib/clubEventOrder";
import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { getServerApiBaseUrl } from "@/shared/services/serverApi";

export function eventFeedTag(school: string): string {
  return `event-feed-${resolveSchool(school)}`;
}

export function eventDetailTag(eventId: number): string {
  return `event-detail-${eventId}`;
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
        tags: [eventDetailTag(eventId)],
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
  options: { clubId?: number; includePast?: boolean } = {},
): Promise<PaginatedEventsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(controlBox.eventDiscovery.serverFeedPageSize),
    school,
  });
  if (options.clubId != null) {
    params.set("club_ids", String(options.clubId));
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

/** Every event for one club, including history, for its public page. */
export async function getClubEventsSnapshot(
  clubId: number,
  school: string,
): Promise<Event[]> {
  const resolvedSchool = resolveSchool(school);
  const fetchOptions = eventFeedFetchOptions(resolvedSchool);
  const options = { clubId, includePast: true };
  const directory = await collectPaginatedPages((page) =>
    fetchEventsPage(resolvedSchool, page, fetchOptions, options),
  );
  return orderClubEvents(directory.items, Date.now());
}

function eventFeedFetchOptions(school: string): RequestInit {
  return {
    next: {
      revalidate:
        process.env.NODE_ENV === "development"
          ? 0
          : controlBox.eventDiscovery.feedRevalidateSeconds,
      tags: [eventFeedTag(school)],
    },
  };
}

export async function getSchoolBrowseSnapshot(school: string): Promise<PaginatedEventsResponse> {
  const resolvedSchool = resolveSchool(school);
  const fetchOptions = eventFeedFetchOptions(resolvedSchool);
  return collectPaginatedPages((page) => fetchEventsPage(resolvedSchool, page, fetchOptions));
}
