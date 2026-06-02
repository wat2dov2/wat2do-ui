import type { ApiEventCreate } from "@/shared/generated";
import type { EventFormData } from "@/shared/types";

/** Map frontend EventFormData to the backend EventCreate payload shape. */
export function buildEventPayload(eventData: EventFormData): ApiEventCreate {
  return {
    title: eventData.title,
    description: eventData.description || null,
    location: eventData.location,
    school: eventData.school?.trim() || null,
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
    organization: eventData.organization || null,
    club_id: eventData.club_id!,
  };
}
