/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import type { Event, EventFormData } from "@/shared/types";
import type { ApiEventResponse } from "@/shared/generated";
import { api } from "@/shared/services/apiClient";

/**
 * Fetch events from backend API.
 *
 * The backend returns `ApiEventResponse[]`; `Event` extends that with
 * a few view-only fields that callers populate ad-hoc when needed.
 */
export async function fetchAllEvents(school?: string): Promise<Event[]> {
  const params = new URLSearchParams();
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
export async function fetchLatestAddedEvent(): Promise<LatestAddedEvent | null> {
  const data = await api.get<LatestAddedEvent | null>("/events/latest-added");
  return data;
}

/**
 * Fetch a single event by ID from the backend API (full details for edit form).
 */
export async function fetchEventById(id: number): Promise<Event> {
  return api.get<ApiEventResponse>(`/events/${id}`);
}

/** Map frontend EventFormData to the backend API payload shape. */
function buildEventPayload(eventData: EventFormData) {
  return {
    title: eventData.title,
    description: eventData.description || null,
    location: eventData.location,
    dtstart_utc: eventData.date ? new Date(`${eventData.date}T${eventData.time || "00:00"}`).toISOString() : null,
    price: eventData.price || null,
    food: eventData.food?.length ? eventData.food : null,
    registration: eventData.requiresRegistration || false,
    category: eventData.category || null,
    organization: eventData.organization || null,
  };
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

// --- Backend-synced RSVPs ("I'm Going") ---

export function toggleRsvpEventAPI(eventId: number, currentRsvpIds: number[]): number[] {
  return currentRsvpIds.includes(eventId)
    ? currentRsvpIds.filter((id) => id !== eventId)
    : [...currentRsvpIds, eventId];
}

export async function fetchRsvpEventIdsFromBackend(): Promise<number[]> {
  return api.get<number[]>("/event-rsvps/");
}

export async function rsvpEventToBackend(eventId: number): Promise<void> {
  await api.put<void>(`/event-rsvps/${eventId}`);
}

export async function unrsvpEventFromBackend(eventId: number): Promise<void> {
  await api.delete(`/event-rsvps/${eventId}`);
}
