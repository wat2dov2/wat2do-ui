import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { EVENTS_PAGE_SIZE } from "@/features/events/constants";
import { resolveSchool } from "@/shared/constants/schools";

const PRODUCTION_API_BASE_URL = "https://wat2do-api-production.up.railway.app";

export const EVENT_FEED_REVALIDATE_SECONDS = 3600;

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

export async function getEventFeedForSchool(
  school: string,
): Promise<PaginatedEventsResponse> {
  const resolvedSchool = resolveSchool(school);
  const params = new URLSearchParams({
    page: "1",
    page_size: String(EVENTS_PAGE_SIZE),
    school: resolvedSchool,
  });
  const response = await fetch(`${getServerApiBaseUrl()}/events/?${params.toString()}`, {
    next: {
      revalidate: EVENT_FEED_REVALIDATE_SECONDS,
      tags: [eventFeedTag(resolvedSchool)],
    },
  });

  if (!response.ok) {
    throw new Error(`Event feed request failed with status ${response.status}`);
  }

  return (await response.json()) as PaginatedEventsResponse;
}
