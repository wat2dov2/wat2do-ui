import type { Event, EventFormData, EventFormOccurrence } from "@/shared/types";
import { getDefaultEventCategory } from "@/shared/data/eventCategories";

/**
 * Event Utilities
 * Handles event data transformations
 */

/**
 * Normalize an event's category to a value we can show in selects/badges.
 * Prefers explicit category; falls back to default.
 */
export function getEventCategory(event: Pick<Event, "category">): string {
  return event.category || getDefaultEventCategory();
}

function toLocalDateTimeInput(value: string): string {
  return new Date(value).toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);
}

function eventOccurrencesToFormOccurrences(event: Event): EventFormOccurrence[] {
  return (event.occurrences ?? []).map((occurrence) => ({
    id: occurrence.id,
    dtstart_local: toLocalDateTimeInput(occurrence.dtstart_utc),
    dtend_local: occurrence.dtend_utc ? toLocalDateTimeInput(occurrence.dtend_utc) : "",
  }));
}

/**
 * Convert Event to EventFormData for edit mode.
 */
export function eventToFormData(event: Event): EventFormData {
  return {
    club_id: event.club_id ?? null,
    title: event.title,
    description: event.description || "",
    occurrences: eventOccurrencesToFormOccurrences(event),
    location: event.location ?? "",
    category: getEventCategory(event),
    price: event.price ?? 0,
    food: event.food || [],
    registration: event.registration ?? false,
    source_image_url: event.source_image_url ?? null,
  };
}

export function getUniqueEvents(events: Event[]): Event[] {
  const seen = new Set<number>();
  return events.filter((event) => {
    if (seen.has(event.id)) {
      return false;
    }
    seen.add(event.id);
    return true;
  });
}

/**
 * Category translation keys.
 * Matches onboarding "What kind of events are you into?" (EVENT_CATEGORIES).
 */
const CATEGORY_TRANSLATION_KEYS: Record<string, string> = {
  "Arts & Culture": "categories.artsAndCulture",
  Business: "categories.business",
  "Community Service": "categories.communityService",
  Environment: "categories.environment",
  "Games & Recreation": "categories.gamesAndRecreation",
  Health: "categories.health",
  "Media & Web": "categories.mediaAndWeb",
  "Politics & Advocacy": "categories.politicsAndAdvocacy",
  "Religion & Spirituality": "categories.religionAndSpirituality",
};

/**
 * Translate category names to localized strings.
 * Options source of truth: `shared/data/eventCategories.ts`.
 */
export function translateCategory(category: string, t: (key: string) => string): string {
  if (!category) return t("navigation.events");
  const key = CATEGORY_TRANSLATION_KEYS[category];
  if (key) return t(key);
  return category;
}
