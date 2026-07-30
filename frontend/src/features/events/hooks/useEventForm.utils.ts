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
   * The poster the form is already showing. JSON input may omit the image, and
   * dropping to null there would silently submit a posterless event while the
   * separate image-preview state still looks right.
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
    organization_id: typeof parsed.organization_id === "number" ? parsed.organization_id : null,
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
    source_image_url:
      (parsed.source_image_url as string) || fallbackDefaults.source_image_url,
  };
}

/**
 * Get smart defaults for form (next hour)
 */
export function getSmartDefaults() {
  const now = new Date();
  const nextHour = new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
  return {
    occurrences: [{ dtstart_local: toLocalDateTimeInput(nextHour), dtend_local: "" }],
  };
}

/**
 * Get initial form state
 */
export function getInitialState(initialData?: EventFormData, isEditMode = false) {
  const smartDefaults = getSmartDefaults();
  const formData =
    isEditMode && initialData
      ? initialData
      : {
        organization_id: null,
        title: "",
        description: "",
        occurrences: smartDefaults.occurrences,
        location: "",
        category: "",
        price: 0,
        food: [],
        registration: false,
        source_image_url: null,
      };

  return {
    formData,
  };
}
