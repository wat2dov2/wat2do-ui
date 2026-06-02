import type { Event, EventFormData, EventFormOccurrence } from "@/shared/types";
import { DEFAULT_EVENT_CATEGORY } from "@/shared/constants/eventCategories";

/**
 * Event Utilities
 * Handles event data transformations
 */

/**
 * Normalize an event's category to a value we can show in selects/badges.
 * Prefers explicit category; falls back to default.
 */
export function getEventCategory(event: Pick<Event, "category">): string {
  return event.category || DEFAULT_EVENT_CATEGORY;
}

function toLocalDateTimeInput(value: string): string {
  return new Date(value).toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);
}

function eventOccurrencesToFormOccurrences(event: Event): EventFormOccurrence[] {
  return (event.occurrences ?? []).map((occurrence) => ({
    dtstart_local: toLocalDateTimeInput(occurrence.dtstart_utc),
    dtend_local: occurrence.dtend_utc ? toLocalDateTimeInput(occurrence.dtend_utc) : "",
  }));
}

/**
 * Convert Event to EventFormData for edit mode.
 */
export function eventToFormData(event: Event): EventFormData {
  return {
    club_id: event.club_id,
    title: event.title,
    description: event.description || "",
    occurrences: eventOccurrencesToFormOccurrences(event),
    location: event.location ?? "",
    category: getEventCategory(event),
    price: event.price ?? 0,
    food: event.food || [],
    registration: event.registration ?? false,
    organization: event.organization || "",
    school: event.school ?? "",
  };
}

/**
 * Deduplicate events by ID to prevent duplicate key warnings in React
 * Returns only the first occurrence of each event ID
 */
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
  Academics: "categories.academics",
  Studying: "categories.studying",
  Career: "categories.career",
  Networking: "categories.networking",
  Games: "categories.games",
  Partying: "categories.partying",
  Athletics: "categories.athletics",
  Art: "categories.art",
  Dance: "categories.dance",
  Culture: "categories.culture",
  Religion: "categories.religion",
  Advocacy: "categories.advocacy",
  Technology: "categories.technology",
  Design: "categories.design",
  Entrepreneurship: "categories.entrepreneurship",
  Health: "categories.health",
  Wellness: "categories.wellness",
  "Mental Health": "categories.mentalHealth",
  Music: "categories.music",
  Sports: "categories.sports",
  Food: "categories.food",
  Volunteering: "categories.volunteering",
};

/**
 * Translate category names to localized strings.
 * Source of truth for options: create event modal (availableCategories in data/events).
 */
export function translateCategory(category: string, t: (key: string) => string): string {
  if (!category) return t("navigation.events");
  const key = CATEGORY_TRANSLATION_KEYS[category];
  if (key) return t(key);
  return category;
}

type CategoryClasses = { bg: string; text: string; border: string };

/** Default category style when no mapping exists */
const DEFAULT_CATEGORY_STYLE: CategoryClasses = {
  bg: "bg-category-default-bg",
  text: "text-category-default-text",
  border: "border-category-default-text/25",
};

function categoryStyle(bg: string, text: string, border: string): CategoryClasses {
  return { bg, text, border };
}

/**
 * Get category color classes for styling.
 * Matches EVENT_CATEGORIES (onboarding + create event modal).
 */
export function getCategoryClasses(category: string): CategoryClasses {
  const academic = categoryStyle("bg-category-academic-bg", "text-category-academic-text", "border-category-academic-text/25");
  const career = categoryStyle("bg-category-career-bg", "text-category-career-text", "border-category-career-text/25");
  const social = categoryStyle("bg-category-social-bg", "text-category-social-text", "border-category-social-text/25");
  const sports = categoryStyle("bg-category-sports-bg", "text-category-sports-text", "border-category-sports-text/25");
  const arts = categoryStyle("bg-category-arts-bg", "text-category-arts-text", "border-category-arts-text/25");
  const cultural = categoryStyle("bg-category-cultural-bg", "text-category-cultural-text", "border-category-cultural-text/25");
  const religious = categoryStyle("bg-category-religious-bg", "text-category-religious-text", "border-category-religious-text/25");
  const technology = categoryStyle("bg-category-technology-bg", "text-category-technology-text", "border-category-technology-text/25");
  const entrepreneurship = categoryStyle(
    "bg-category-entrepreneurship-bg",
    "text-category-entrepreneurship-text",
    "border-category-entrepreneurship-text/25"
  );
  const health = categoryStyle("bg-category-health-bg", "text-category-health-text", "border-category-health-text/25");
  const music = categoryStyle("bg-category-music-bg", "text-category-music-text", "border-category-music-text/25");

  const mapping: Record<string, CategoryClasses> = {
    Academics: academic,
    Studying: academic,
    Career: career,
    Networking: career,
    Games: social,
    Partying: social,
    Athletics: sports,
    Sports: sports,
    Art: arts,
    Dance: arts,
    Design: arts,
    Culture: cultural,
    Religion: religious,
    Advocacy: cultural,
    Technology: technology,
    Entrepreneurship: entrepreneurship,
    Health: health,
    Wellness: health,
    "Mental Health": health,
    Music: music,
    Food: academic,
    Volunteering: entrepreneurship,
    Events: categoryStyle("bg-category-events-bg", "text-category-events-text", "border-category-events-text/25"),
  };
  return mapping[category] || DEFAULT_CATEGORY_STYLE;
}
