/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import type { Event, EventFormData } from "@/shared/types";
import { api } from "@/shared/services/apiClient";
import {
  createEvent,
  updateEvent as updateEventService,
  getEventById,
} from "@/features/events/api/eventService";
import { filterEvents, sortEvents, type SearchFilters, type SortOptions } from "@/features/search";

/**
 * Fetch events from backend API.
 */
export async function fetchAllEvents(): Promise<Event[]> {
  const apiEvents = await api.get<Event[]>("/events/");
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
  return api.get<Event>(`/events/${id}`);
}

export async function createEventAPI(
  eventData: EventFormData,
  getDayOfWeek: (date: string) => string,
): Promise<Event> {
  try {
    return await api.post<Event>("/events/", {
      title: eventData.title,
      description: eventData.description || null,
      location: eventData.location,
      dtstart_utc: eventData.date ? new Date(`${eventData.date}T${eventData.time || "00:00"}`).toISOString() : null,
      price: eventData.price || null,
      food: eventData.food?.length ? eventData.food : null,
      registration: eventData.requiresRegistration || false,
      category: eventData.category || null,
      organization: eventData.organization || null,
    });
  } catch (error) {
    console.warn("Backend event creation failed, using local fallback:", error);
    return createEvent(eventData, getDayOfWeek);
  }
}

export async function updateEventAPI(
  event: Event,
  eventData: EventFormData,
  getDayOfWeek: (date: string) => string,
): Promise<Event> {
  try {
    const updated = await api.patch<Event>(`/events/${event.id}`, {
      title: eventData.title,
      description: eventData.description || null,
      location: eventData.location,
      dtstart_utc: eventData.date ? new Date(`${eventData.date}T${eventData.time || "00:00"}`).toISOString() : null,
      price: eventData.price || null,
      food: eventData.food?.length ? eventData.food : null,
      registration: eventData.requiresRegistration || false,
      category: eventData.category || null,
      organization: eventData.organization || null,
    });
    return updated;
  } catch (error) {
    console.warn("Backend event update failed, using local fallback:", error);
    return updateEventService(event, eventData, getDayOfWeek);
  }
}

export async function deleteEventAPI(eventId: number): Promise<void> {
  await api.delete(`/events/${eventId}`);
}

export function filterEventsAPI(events: Event[], filters: SearchFilters): Event[] {
  return filterEvents(events, filters);
}

export function sortEventsAPI(events: Event[], sortOptions: SortOptions): Event[] {
  return sortEvents(events, sortOptions);
}

export function getEventByIdAPI(events: Event[], id: number): Event | undefined {
  return getEventById(events, id);
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
  await api.put<unknown>(`/saved-events/${eventId}`);
}

export async function unsaveEventFromBackend(eventId: number): Promise<void> {
  await api.delete(`/saved-events/${eventId}`);
}
