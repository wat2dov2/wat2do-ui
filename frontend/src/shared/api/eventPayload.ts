import type { ApiEventCreate } from "@/shared/generated";
import type { components } from "@/shared/generated/api-types";
import type { EventFormData } from "@/shared/types";

/** Map frontend EventFormData to the backend EventCreate payload shape. */
export function buildEventPayload(eventData: EventFormData): ApiEventCreate {
  return {
    title: eventData.title,
    description: eventData.description || null,
    location: eventData.location,
    occurrences: eventData.occurrences
      .filter((occurrence) => occurrence.dtstart_local)
      .map((occurrence) => ({
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
    organization_id: eventData.organization_id!,
    source_image_url: eventData.source_image_url || null,
    cancelled: false,
  };
}

export function buildEventUpdatePayload(
  eventData: EventFormData,
): components["schemas"]["EventUpdate"] {
  return {
    ...buildEventPayload(eventData),
    // An event scraped without an organization stays that way: send nothing
    // rather than a null the server would read as "clear the link".
    organization_id: eventData.organization_id ?? undefined,
    occurrences: eventData.occurrences
      .filter((occurrence) => occurrence.dtstart_local)
      .map((occurrence) => ({
        id: occurrence.id,
        dtstart_utc: new Date(occurrence.dtstart_local).toISOString(),
        dtend_utc: occurrence.dtend_local
          ? new Date(occurrence.dtend_local).toISOString()
          : null,
        duration: null,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      })),
  };
}
