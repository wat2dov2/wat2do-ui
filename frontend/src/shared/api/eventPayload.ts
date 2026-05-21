import type { ApiEventCreate } from "@/shared/generated";
import type { EventFormData } from "@/shared/types";

/** Map frontend EventFormData to the backend EventCreate payload shape. */
export function buildEventPayload(eventData: EventFormData): ApiEventCreate {
  const startsAt = eventData.date
    ? new Date(`${eventData.date}T${eventData.time || "00:00"}`).toISOString()
    : null;

  return {
    title: eventData.title,
    description: eventData.description || null,
    location: eventData.location,
    occurrences: startsAt
      ? [{
          dtstart_utc: startsAt,
          dtend_utc: null,
          duration: null,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        }]
      : [],
    price: eventData.price || null,
    food: eventData.food?.length ? eventData.food : null,
    registration: eventData.requiresRegistration || false,
    category: eventData.category || null,
    organization: eventData.organization,
  };
}
