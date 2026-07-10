/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import type { Event, EventFormData } from "@/shared/types";
import type {
  ApiEventPublicResponse,
  ApiEventResponse,
} from "@/shared/generated";
import { buildEventPayload } from "@/shared/api/eventPayload";
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
  return api.patch<ApiEventResponse>(`/events/${eventId}`, buildEventPayload(eventData));
}

export async function deleteEventAPI(eventId: number): Promise<void> {
  await api.delete(`/events/${eventId}`);
}

export type GoingEventStatusResponse = {
  status: string;
  going_count: number;
};

export function toggleGoingEventAPI(eventId: number, currentIds: number[]): number[] {
  return currentIds.includes(eventId)
    ? currentIds.filter((id) => id !== eventId)
    : [...currentIds, eventId];
}

export async function fetchGoingEventIdsFromBackend(): Promise<number[]> {
  return api.get<number[]>("/going-events/");
}

export async function markGoingOnBackend(
  eventId: number,
): Promise<GoingEventStatusResponse> {
  return api.put<GoingEventStatusResponse>(`/going-events/${eventId}`);
}

export async function unmarkGoingOnBackend(
  eventId: number,
): Promise<GoingEventStatusResponse> {
  return api.delete<GoingEventStatusResponse>(`/going-events/${eventId}`);
}

export async function fetchGoingCountsFromBackend(
  school: string,
): Promise<Record<string, number>> {
  const params = new URLSearchParams({ school });
  return api.get<Record<string, number>>(`/going-events/counts?${params.toString()}`);
}

export async function reportEventToBackend(eventId: number, reason: string): Promise<void> {
  await api.post("/reports/", { event_id: eventId, reason });
}
