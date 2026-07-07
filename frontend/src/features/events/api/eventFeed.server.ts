import type { Event } from "@/shared/types";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { resolveSchool } from "@/shared/constants/schools";

const PRODUCTION_API_BASE_URL = "https://wat2do-api-production.up.railway.app";

const EVENT_FEED_REVALIDATE_SECONDS = 3600;

/** Backend `PaginationParams.page_size` maximum. */
const SERVER_FEED_PAGE_SIZE = 100;

export interface SchoolBrowseSnapshot {
  feed: PaginatedEventsResponse;
  promotedEvents: Event[];
}

function getServerApiBaseUrl(): string {
  const configuredBackendApiUrl = process.env.BACKEND_API_URL?.trim();
  if (configuredBackendApiUrl) return configuredBackendApiUrl.replace(/\/$/, "");

  const configuredPublicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configuredPublicApiUrl?.startsWith("http://") || configuredPublicApiUrl?.startsWith("https://")) {
    return configuredPublicApiUrl.replace(/\/$/, "");
  }

  return process.env.NODE_ENV === "development"
    ? "http://localhost:8000"
    : PRODUCTION_API_BASE_URL;
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
    page_size: String(SERVER_FEED_PAGE_SIZE),
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
      revalidate: process.env.NODE_ENV === "development" ? 0 : EVENT_FEED_REVALIDATE_SECONDS,
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
    page_size: allItems.length || SERVER_FEED_PAGE_SIZE,
    total_pages: 1,
    latest_added_event: firstPage.latest_added_event ?? null,
  };

  const promotedEvents = await fetchPromotedEvents(resolvedSchool, fetchOptions);

  return { feed, promotedEvents };
}
