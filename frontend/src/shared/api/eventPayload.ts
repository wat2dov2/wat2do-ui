import type { ApiEventCreate } from "@/shared/generated";
import type { components } from "@/shared/generated/api-types";
import type { EventFormData, EventFormOccurrence } from "@/shared/types";
import { localDateTimeToUtc } from "@/shared/utils/date";

function submittedOccurrences(eventData: EventFormData) {
  return eventData.occurrences.filter((occurrence) => occurrence.dtstart_local);
}

export function buildEventOccurrence(occurrence: EventFormOccurrence, timeZone: string): ApiEventCreate["occurrences"][number] {
  return {
    dtstart_utc: localDateTimeToUtc(occurrence.dtstart_local, timeZone, occurrence.original?.dtstart_utc),
    dtend_utc: occurrence.dtend_local
      ? localDateTimeToUtc(occurrence.dtend_local, timeZone, occurrence.original?.dtend_utc)
      : null,
    duration: null,
    tz: timeZone,
  };
}

/** Map frontend EventFormData to the backend EventCreate payload shape. */
export function buildEventPayload(eventData: EventFormData): ApiEventCreate {
  return {
    title: eventData.title,
    description: eventData.description || null,
    location: eventData.location,
    occurrences: submittedOccurrences(eventData).map((occurrence) => buildEventOccurrence(occurrence, eventData.timeZone)),
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
