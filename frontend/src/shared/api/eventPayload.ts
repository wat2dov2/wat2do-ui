import type { ApiEventCreate } from "@/shared/generated";
import type { components } from "@/shared/generated/api-types";
import type { EventFormData } from "@/shared/types";

function submittedOccurrences(eventData: EventFormData) {
  return eventData.occurrences.filter((occurrence) => occurrence.dtstart_local);
}

/** Map frontend EventFormData to the backend EventCreate payload shape. */
export function buildEventPayload(eventData: EventFormData): ApiEventCreate {
  return {
    title: eventData.title,
    description: eventData.description || null,
    location: eventData.location,
    occurrences: submittedOccurrences(eventData).map((occurrence) => ({
      dtstart_utc: new Date(occurrence.dtstart_local).toISOString(),
      dtend_utc: occurrence.dtend_local
        ? new Date(occurrence.dtend_local).toISOString()
        : null,
      duration: null,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    })),
    price: eventData.price || null,
    food: eventData.food?.length ? eventData.food : null,
    registration: eventData.registration || false,
    category: eventData.category || null,
    club_id: eventData.club_id!,
    source_url: eventData.source_url || null,
    source_image_url: eventData.source_image_url || null,
    cancelled: false,
  };
}

export function buildEventUpdatePayload(
  eventData: EventFormData,
): components["schemas"]["EventUpdate"] {
  const payload = buildEventPayload(eventData);
  const occurrences = submittedOccurrences(eventData);
  return {
    ...payload,
    // An event scraped without a club stays that way: send nothing
    // rather than a null the server would read as "clear the link".
    club_id: eventData.club_id ?? undefined,
    occurrences: payload.occurrences.map((occurrence, index) => ({
      id: occurrences[index].id,
      ...occurrence,
    })),
  };
}
