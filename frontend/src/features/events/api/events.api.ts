/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import type { Event, EventFormData } from "@/shared/types";
import type {
  ApiEventAttendeesResponse,
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
import { api } from "@/shared/services/apiClient";

export type LatestAddedEvent = {
  title: string;
  added_at: string;
} | null;

export type PaginatedEventsResponse = {
  items: Event[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  latest_added_event: LatestAddedEvent;
};

/**
 * Fetch a single event by ID from the backend API (full details for edit form).
 */
export async function fetchEventById(id: number): Promise<Event> {
  return api.get<ApiEventPublicResponse>(`/events/${id}`);
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

export type EventAttendees = ApiEventAttendeesResponse;

/** Public who's-going summary (count + abbreviated display names). */
export async function fetchEventAttendees(eventId: number): Promise<EventAttendees> {
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
