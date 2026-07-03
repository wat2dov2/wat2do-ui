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

export function toggleSaveEventAPI(eventId: number, currentSavedIds: number[]): number[] {
  return currentSavedIds.includes(eventId)
    ? currentSavedIds.filter((id) => id !== eventId)
    : [...currentSavedIds, eventId];
}

export async function fetchSavedEventIdsFromBackend(): Promise<number[]> {
  return api.get<number[]>("/saved-events/");
}

export async function saveEventToBackend(eventId: number): Promise<void> {
  await api.put<void>(`/saved-events/${eventId}`);
}

export async function unsaveEventFromBackend(eventId: number): Promise<void> {
  await api.delete(`/saved-events/${eventId}`);
}

export async function reportEventToBackend(eventId: number, reason: string): Promise<void> {
  await api.post("/reports/", { event_id: eventId, reason });
}
