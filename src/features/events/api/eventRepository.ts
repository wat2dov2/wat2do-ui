import type { Event } from "@/shared/types";
import { StorageService } from "@/shared/services/storageService";

/**
 * Event Repository
 * Handles event data persistence
 */

const STORAGE_KEYS = {
  USER_CREATED_EVENTS: "userCreatedEvents",
  USER_CREATED_EVENT_IDS: "userCreatedEventIds",
  SAVED_EVENT_IDS: "savedEventIds",
} as const;

/**
 * Load user-created events from localStorage
 */
export function loadUserEvents(): Event[] {
  return StorageService.getItem<Event[]>(STORAGE_KEYS.USER_CREATED_EVENTS, []);
}

/**
 * Save user-created events to localStorage
 */
export function saveUserEvents(events: Event[]): void {
  StorageService.setItem(STORAGE_KEYS.USER_CREATED_EVENTS, events);
}

/**
 * Load user-created event IDs from localStorage
 */
export function loadUserEventIds(): number[] {
  return StorageService.getItem<number[]>(
    STORAGE_KEYS.USER_CREATED_EVENT_IDS,
    []
  );
}

/**
 * Save user-created event IDs to localStorage
 */
export function saveUserEventIds(ids: number[]): void {
  StorageService.setItem(STORAGE_KEYS.USER_CREATED_EVENT_IDS, ids);
}

/**
 * Save both events and IDs together
 */
export function saveUserEventsAndIds(
  events: Event[],
  ids: number[]
): void {
  saveUserEvents(events);
  saveUserEventIds(ids);
}

/**
 * Remove a user-created event
 */
export function removeUserEvent(eventId: number): void {
  const events = loadUserEvents();
  const ids = loadUserEventIds();

  const filteredEvents = events.filter((e) => e.id !== eventId);
  const filteredIds = ids.filter((id) => id !== eventId);

  saveUserEventsAndIds(filteredEvents, filteredIds);
}

/**
 * Saved Events Repository
 */

/**
 * Load saved event IDs from localStorage
 */
export function loadSavedEventIds(): number[] {
  return StorageService.getItem<number[]>(STORAGE_KEYS.SAVED_EVENT_IDS, []);
}

/**
 * Save saved event IDs to localStorage
 */
export function saveSavedEventIds(ids: number[]): void {
  StorageService.setItem(STORAGE_KEYS.SAVED_EVENT_IDS, ids);
}
