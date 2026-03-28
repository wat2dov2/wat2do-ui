/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import type { Event, EventFormData } from "@/shared/types";
import { api } from "@/shared/services/apiClient";
import {
  loadUserEvents,
  saveUserEvents,
  loadUserEventIds,
  saveUserEventIds,
  removeUserEvent,
  loadSavedEventIds,
  saveSavedEventIds,
} from "@/features/events/api/eventRepository";
import {
  createEvent,
  updateEvent as updateEventService,
  getEventById,
} from "@/features/events/api/eventService";
import { filterEvents, sortEvents, type SearchFilters, type SortOptions } from "@/features/search";
import { getUniqueEvents } from "@/shared/utils/event";

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

/**
 * Kept for backward compat — returns an empty list.
 * Components should use fetchAllEvents() instead.
 */
export function loadAllEvents(): Event[] {
  return [];
}

export function saveEvents(events: Event[], eventIds: number[]): void {
  saveUserEvents(events);
  saveUserEventIds(eventIds);
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
  } catch {
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
  } catch {
    return updateEventService(event, eventData, getDayOfWeek);
  }
}

export async function deleteEventAPI(eventId: number): Promise<void> {
  try {
    await api.delete(`/events/${eventId}`);
  } catch {
    // still clean up local
  }
  removeUserEvent(eventId);
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

export function loadSavedEventIdsAPI(): number[] {
  return loadSavedEventIds();
}

export function saveSavedEventIdsAPI(ids: number[]): void {
  saveSavedEventIds(ids);
}

export function toggleSaveEventAPI(eventId: number, currentSavedIds: number[]): number[] {
  return currentSavedIds.includes(eventId)
    ? currentSavedIds.filter((id) => id !== eventId)
    : [...currentSavedIds, eventId];
}
