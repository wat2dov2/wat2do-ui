/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import type { Event, EventFormData } from "@/shared/types";
import type { ApiEventResponse } from "@/shared/generated";
import { buildEventPayload } from "@/shared/api/eventPayload";
import { api } from "@/shared/services/apiClient";

/**
 * Fetch events from backend API.
 *
 * The backend returns `ApiEventResponse[]`; `Event` extends that with
 * a few view-only fields that callers populate ad-hoc when needed.
 */
export async function fetchAllEvents(school?: string): Promise<Event[]> {
  const params = new URLSearchParams();
  params.set("summary", "true");
  if (school) params.set("school", school);
  const qs = params.toString();
  const apiEvents = await api.get<ApiEventResponse[]>(`/events/${qs ? `?${qs}` : ""}`);
  return apiEvents;
}

/** Response from GET /events/latest-added */
export interface LatestAddedEvent {
  title: string;
  added_at: string;
}

/**
 * Fetch the most recently added event (for "X added 22 minutes ago" text).
 */
export async function fetchLatestAddedEvent(school?: string): Promise<LatestAddedEvent | null> {
  const params = new URLSearchParams();
  if (school) params.set("school", school);
  const qs = params.toString();
  const data = await api.get<LatestAddedEvent | null>(`/events/latest-added${qs ? `?${qs}` : ""}`);
  return data;
}

/**
 * Fetch a single event by ID from the backend API (full details for edit form).
 */
export async function fetchEventById(id: number): Promise<Event> {
  return api.get<ApiEventResponse>(`/events/${id}`);
}

export async function createEventAPI(eventData: EventFormData): Promise<Event> {
  // Re-throw backend errors so callers can display real error messages.
  // Local fabrication of persisted resources is never correct.
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

// --- Backend-synced saved events ---

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
