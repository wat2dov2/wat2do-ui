/**
 * Events API
 * Handles all event-related data operations
 * 
 * This is the public API for the events feature.
 * It consolidates repository and service operations.
 */

import type { Event, EventFormData } from "@/shared/types";
import { mockEvents } from "@/features/events/data/events";
import {
  loadUserEvents,
  saveUserEvents,
  loadUserEventIds,
  saveUserEventIds,
  removeUserEvent,
} from "@/features/events/api/eventRepository";
import {
  createEvent,
  updateEvent as updateEventService,
  getEventById,
} from "@/features/events/api/eventService";
import { filterEvents, sortEvents, type SearchFilters, type SortOptions } from "@/features/search";
import { getUniqueEvents } from "@/shared/utils/event";
import {
  loadSavedEventIds,
  saveSavedEventIds,
} from "@/features/events/api/eventRepository";

/**
 * Load all events (mock + user-created)
 * Deduplicates to prevent duplicate events from localStorage
 */
export function loadAllEvents(): Event[] {
  const userEvents = loadUserEvents();
  const allEvents = [...mockEvents, ...userEvents];
  return getUniqueEvents(allEvents);
}

/**
 * Save user-created events
 */
export function saveEvents(events: Event[], eventIds: number[]): void {
  saveUserEvents(events);
  saveUserEventIds(eventIds);
}

/**
 * Create a new event
 * Automatically persists to localStorage
 */
export function createEventAPI(
  eventData: EventFormData,
  getDayOfWeek: (date: string) => string
): Event {
  const newEvent = createEvent(eventData, getDayOfWeek);
  
  // Persist to localStorage
  const userEvents = loadUserEvents();
  const userEventIds = loadUserEventIds();
  
  // Check if event already exists (deduplication)
  if (!userEventIds.includes(newEvent.id)) {
    saveUserEvents([...userEvents, newEvent]);
    saveUserEventIds([...userEventIds, newEvent.id]);
  }
  
  return newEvent;
}

/**
 * Update an existing event
 * Automatically persists to localStorage if it's a user-created event
 */
export function updateEventAPI(
  event: Event,
  eventData: EventFormData,
  getDayOfWeek: (date: string) => string
): Event {
  const updatedEvent = updateEventService(event, eventData, getDayOfWeek);
  
  // Persist to localStorage if it's a user-created event
  const userEventIds = loadUserEventIds();
  if (userEventIds.includes(event.id)) {
    const userEvents = loadUserEvents();
    const updatedEvents = userEvents.map((e) =>
      e.id === event.id ? updatedEvent : e
    );
    saveUserEvents(updatedEvents);
  }
  
  return updatedEvent;
}

/**
 * Delete an event
 * Automatically persists to localStorage
 */
export function deleteEventAPI(eventId: number): void {
  removeUserEvent(eventId);
}

/**
 * Filter events
 * Delegates to search feature
 */
export function filterEventsAPI(
  events: Event[],
  filters: SearchFilters
): Event[] {
  return filterEvents(events, filters);
}

/**
 * Sort events
 */
export function sortEventsAPI(
  events: Event[],
  sortOptions: SortOptions
): Event[] {
  return sortEvents(events, sortOptions);
}

/**
 * Get event by ID
 */
export function getEventByIdAPI(
  events: Event[],
  id: number
): Event | undefined {
  return getEventById(events, id);
}

/**
 * Saved Events API
 */

/**
 * Load saved event IDs
 */
export function loadSavedEventIdsAPI(): number[] {
  return loadSavedEventIds();
}

/**
 * Save event IDs
 */
export function saveSavedEventIdsAPI(ids: number[]): void {
  saveSavedEventIds(ids);
}

/**
 * Toggle save event (add or remove from saved list)
 */
export function toggleSaveEventAPI(
  eventId: number,
  currentSavedIds: number[]
): number[] {
  return currentSavedIds.includes(eventId)
    ? currentSavedIds.filter((id) => id !== eventId)
    : [...currentSavedIds, eventId];
}
