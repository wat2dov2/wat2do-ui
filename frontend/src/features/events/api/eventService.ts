import type { Event } from "@/shared/types";

/**
 * Event Service
 *
 * Note: Filtering and sorting are handled by the search feature.
 * Import filterEvents and sortEvents from @/features/search.
 *
 * Event creation and updates go through the backend via
 * createEventAPI / updateEventAPI in events.api.ts — there is no
 * local fabrication path here.
 */

/**
 * Get event by ID from an in-memory list.
 */
export function getEventById(events: Event[], id: number): Event | undefined {
  return events.find((event) => event.id === id);
}
