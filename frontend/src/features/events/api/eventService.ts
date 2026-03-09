import type { Event, EventFormData } from "@/shared/types";

/**
 * Event Service
 * Handles event CRUD operations
 * 
 * Note: Filtering and sorting are handled by the search feature.
 * Import filterEvents and sortEvents from @/features/search
 */

/**
 * Create a new event from form data
 */
export function createEvent(
  eventData: EventFormData,
  getDayOfWeek: (date: string) => string
): Event {
  const newId = Date.now();
  return {
    id: newId,
    title: eventData.title,
    category: eventData.category || "Events",
    organization: eventData.organization,
    location: eventData.location,
    date: eventData.date,
    time: eventData.time,
    isLive: false,
    food: eventData.food || [],
    price: eventData.price || 0,
    dayOfWeek: getDayOfWeek(eventData.date),
    requiresRegistration: eventData.requiresRegistration || false,
    addedDate: new Date(),
    description: eventData.description || "",
    eventDate: new Date(eventData.date),
  };
}

/**
 * Update an existing event
 */
export function updateEvent(
  event: Event,
  eventData: EventFormData,
  getDayOfWeek: (date: string) => string
): Event {
  return {
    ...event,
    title: eventData.title,
    description: eventData.description || "",
    date: eventData.date,
    time: eventData.time,
    location: eventData.location,
    category: eventData.category || "Events",
    price: eventData.price || 0,
    food: eventData.food || [],
    requiresRegistration: eventData.requiresRegistration || false,
    organization: eventData.organization,
    dayOfWeek: getDayOfWeek(eventData.date),
    eventDate: new Date(eventData.date),
  };
}

/**
 * Get event by ID
 */
export function getEventById(events: Event[], id: number): Event | undefined {
  return events.find((event) => event.id === id);
}

/**
 * Note: getFilterCounts has been moved to @/features/search
 * Import it from @/features/search/api/searchService
 */
