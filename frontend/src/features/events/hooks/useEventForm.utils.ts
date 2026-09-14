import type { EventFormData, EventFormOccurrence } from "@/shared/types";

function toLocalDateTimeInput(date: Date): string {
  return date.toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);
}

function normalizeOccurrences(
  raw: unknown,
  fallback: EventFormOccurrence[],
): EventFormOccurrence[] {
  if (!Array.isArray(raw)) return fallback;
  const occurrences = raw
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      dtstart_local: typeof item.dtstart_local === "string" ? item.dtstart_local : "",
      dtend_local: typeof item.dtend_local === "string" ? item.dtend_local : "",
    }))
    .filter((item) => item.dtstart_local);
  return occurrences.length > 0 ? occurrences : fallback;
}

/** What the form already holds for fields a payload may simply not carry. */
interface EventInputFallbacks {
  occurrences: EventFormOccurrence[];
  /**
   * The poster the form is already showing. A parsed flyer may omit the image,
   * and dropping to null there would silently submit a posterless event while
   * the separate image-preview state still looks right.
   */
  source_image_url: string | null;
}

/**
 * Map a parsed event object to EventFormData, applying fallback defaults for
 * missing fields.
 */
export function mapEventInputToFormData(
  parsed: Record<string, unknown>,
  fallbackDefaults: EventInputFallbacks,
): EventFormData {
  return {
    club_id: typeof parsed.club_id === "number" ? parsed.club_id : null,
    title: (parsed.title as string) || "",
    description: (parsed.description as string) || "",
    occurrences: normalizeOccurrences(parsed.occurrences, fallbackDefaults.occurrences),
    location: (parsed.location as string) || "",
    category: (parsed.category as string) || "",
    price: typeof parsed.price === "number" ? parsed.price : 0,
    food: Array.isArray(parsed.food) ? parsed.food : [],
    registration:
      typeof parsed.registration === "boolean"
        ? parsed.registration
        : false,
    source_url: (parsed.source_url as string) || null,
    source_image_url:
      (parsed.source_image_url as string) || fallbackDefaults.source_image_url,
  };
}

/** New events start at the next local hour. */
export function getEventFormDefaults(): EventFormData {
  const now = new Date();
  const nextHour = new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
  return {
    club_id: null,
    title: "",
    description: "",
    occurrences: [{ dtstart_local: toLocalDateTimeInput(nextHour), dtend_local: "" }],
    location: "",
    category: "",
    price: 0,
    food: [],
    registration: false,
    source_url: null,
    source_image_url: null,
  };
}
