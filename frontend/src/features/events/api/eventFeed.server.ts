import { readDiscoverySnapshot } from "@/shared/services/discoveryCache.server";
import { collectPaginatedPages } from "@/shared/lib/pagination";
import type { Event } from "@/shared/types";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { orderClubEvents } from "@/features/events/lib/clubEventOrder";
import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { fetchServerSnapshot, getServerApiBaseUrl } from "@/shared/services/serverApi";

/** Public event detail shared by route metadata, initial HTML, and hydration. */
export async function getEventDetailSnapshot(eventId: number): Promise<Event | null> {
  const response = await fetchServerSnapshot(
    `${getServerApiBaseUrl()}/events/${encodeURIComponent(String(eventId))}`,
    { cache: "no-store" },
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
  const response = await fetchServerSnapshot(`${getServerApiBaseUrl()}/events/?${params.toString()}`, fetchOptions);

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
  const fetchOptions: RequestInit = { cache: "no-store" };
  const options = { clubId, includePast: true };
  const directory = await collectPaginatedPages((page) =>
    fetchEventsPage(resolvedSchool, page, fetchOptions, options),
  );
  return orderClubEvents(directory.items, Date.now());
}

export async function buildSchoolBrowseSnapshot(school: string): Promise<PaginatedEventsResponse> {
  const resolvedSchool = resolveSchool(school);
  const fetchOptions: RequestInit = { cache: "no-store" };
  return collectPaginatedPages((page) => fetchEventsPage(resolvedSchool, page, fetchOptions));
}

export async function getSchoolBrowseSnapshot(school: string) {
  const slug = resolveSchool(school);
  return readDiscoverySnapshot(slug, "events", () => buildSchoolBrowseSnapshot(slug));
}
