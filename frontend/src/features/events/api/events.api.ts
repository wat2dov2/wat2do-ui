/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import type { Event, EventFormData } from "@/shared/types";
import type {
  ApiEventAttendeesResponse,
  ApiEventFeedResponse,
  ApiLatestAddedItem,
  ApiEventPublicResponse,
  ApiEventResponse,
  ApiEventStatsResponse,
  ApiGoingEventSelection,
  ApiGoingEventSelectionUpdate,
  ApiGoingEventStatusResponse,
} from "@/shared/generated";
import {
  buildEventPayload,
  buildEventUpdatePayload,
} from "@/shared/api/eventPayload";
import { api, getPaginatedItems } from "@/shared/services/apiClient";

export type LatestAddedEvent = ApiLatestAddedItem | null;

export type PaginatedEventsResponse = Omit<ApiEventFeedResponse, "items" | "latest_added_event"> & {
  items: Event[];
  latest_added_event: LatestAddedEvent;
};

/**
 * Fetch a single event by ID from the backend API (full details for edit form).
 */
export async function fetchEventById(id: number): Promise<Event> {
  return api.get<ApiEventPublicResponse>(`/events/${id}`);
}

export async function fetchEventFeed(
  school?: string,
  { clubId, includePast = false }: EventFeedOptions = {},
): Promise<Event[]> {
  const params = new URLSearchParams({
    sort_by: "date",
    sort_order: "asc",
  });
  if (school) params.append("school", school);
  if (clubId != null) {
    params.append("club_ids", String(clubId));
  }
  if (includePast) {
    params.append("include_past", "true");
  }
  return getPaginatedItems<Event>(`/events/?${params.toString()}`);
}

interface EventFeedOptions {
  clubId?: number;
  /** Drop the server's start-of-today lower bound and return past events too. */
  includePast?: boolean;
}

/**
 * Every event a host has ever run, past included.
 *
 * The club page is the host's whole record, not just what is still to
 * come, so it opts out of the feed's default start-of-today lower bound.
 */
export async function fetchClubEvents(
  clubId: number,
  school: string,
): Promise<Event[]> {
  return fetchEventFeed(school, { clubId, includePast: true });
}

export async function createEventAPI(eventData: EventFormData): Promise<Event> {
  return api.post<ApiEventResponse>("/events/", buildEventPayload(eventData));
}

export async function updateEventAPI(
  eventId: number,
  eventData: EventFormData,
): Promise<Event> {
  return api.patch<ApiEventResponse>(
    `/events/${eventId}`,
    buildEventUpdatePayload(eventData),
  );
}

export async function deleteEventAPI(eventId: number): Promise<void> {
  await api.delete(`/events/${eventId}`);
}

export type EventStats = ApiEventStatsResponse;

/** Public who's-going summary (count + abbreviated display names). */
export async function fetchEventAttendees(eventId: number): Promise<ApiEventAttendeesResponse> {
  return api.get<ApiEventAttendeesResponse>(`/going-events/${eventId}/attendees`);
}

export async function fetchGoingEvents(): Promise<ApiGoingEventSelection[]> {
  return api.get<ApiGoingEventSelection[]>("/going-events/");
}

export async function setGoingEventOccurrences(
  eventId: number,
  occurrenceIds: string[],
): Promise<ApiGoingEventStatusResponse> {
  const body: ApiGoingEventSelectionUpdate = { occurrence_ids: occurrenceIds };
  return api.put<ApiGoingEventStatusResponse>(`/going-events/${eventId}`, body);
}

export async function clearGoingEvent(
  eventId: number,
): Promise<ApiGoingEventStatusResponse> {
  return api.delete<ApiGoingEventStatusResponse>(`/going-events/${eventId}`);
}

export async function fetchEventStatsFromBackend(
  school: string,
): Promise<Record<string, EventStats>> {
  const params = new URLSearchParams({ school });
  return api.get<Record<string, EventStats>>(`/events/stats?${params.toString()}`);
}

export async function reportEventToBackend(eventId: number, reason: string): Promise<void> {
  await api.post("/reports/", { event_id: eventId, reason });
}
