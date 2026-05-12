import type { Event, EventFormData } from "@/shared/types";
import { DEFAULT_EVENT_CATEGORY } from "@/shared/constants/eventCategories";

/**
 * Event Utilities
 * Handles event data transformations
 */

/**
 * Derive a canonical category from club_type when category is missing.
 * This keeps list views and edit forms consistent.
 */
function deriveCategoryFromClubType(clubType?: string): string {
  const mapping: Record<string, string> = {
    WUSA: "Games",
    Athletics: "Athletics",
    "Student Society": "Academics",
  };
  return clubType ? (mapping[clubType] || DEFAULT_EVENT_CATEGORY) : DEFAULT_EVENT_CATEGORY;
}

/**
 * Normalize an event's category to a value we can show in selects/badges.
 * Prefers explicit category; falls back to club_type-derived category.
 */
export function getEventCategory(event: Pick<Event, "category" | "club_type">): string {
  return event.category || deriveCategoryFromClubType(event.club_type);
}

/**
 * Convert Event to EventFormData for edit mode.
 * Falls back to dtstart_utc when date/time strings are missing, and
 * handles both old (requiresRegistration) and new (registration) fields.
 */
export function eventToFormData(event: Event): EventFormData {
  let date = event.date || "";
  let time = event.time || "";
  if ((!date || !time) && event.dtstart_utc) {
    const d = new Date(event.dtstart_utc as string);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      date = date || `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      time = time || `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  return {
    title: event.title,
    description: event.description || "",
    date,
    time,
    location: event.location ?? "",
    category: getEventCategory(event),
    price: event.price ?? 0,
    food: event.food || [],
    requiresRegistration: event.requiresRegistration ?? event.registration ?? false,
    organization: event.organization || "",
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
 * Legacy keys support existing data that may use old category names.
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
  Events: "categories.events",
  // Legacy (old data)
  Clubs: "categories.clubs",
  Academic: "categories.academics",
  Religious: "categories.religion",
  Cultural: "categories.culture",
  "Social & Games": "categories.games",
  "Sports & Fitness": "categories.sports",
  "Career & Networking": "categories.career",
  "Creative Arts": "categories.art",
  "Arts & Crafts": "categories.art",
  "Health & Wellness": "categories.health",
  "Music & Performance": "categories.music",
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

/** Default category style when no mapping exists */
const DEFAULT_CATEGORY_STYLE = { bg: "bg-category-default-bg", text: "text-category-default-text" };

/**
 * Get category color classes for styling.
 * Matches EVENT_CATEGORIES (onboarding + create event modal).
 */
export function getCategoryClasses(category: string): { bg: string; text: string } {
  const mapping: Record<string, { bg: string; text: string }> = {
    Academics: { bg: "bg-category-academic-bg", text: "text-category-academic-text" },
    Studying: { bg: "bg-category-academic-bg", text: "text-category-academic-text" },
    Career: { bg: "bg-category-career-bg", text: "text-category-career-text" },
    Networking: { bg: "bg-category-career-bg", text: "text-category-career-text" },
    Games: { bg: "bg-category-social-bg", text: "text-category-social-text" },
    Partying: { bg: "bg-category-social-bg", text: "text-category-social-text" },
    Athletics: { bg: "bg-category-sports-bg", text: "text-category-sports-text" },
    Sports: { bg: "bg-category-sports-bg", text: "text-category-sports-text" },
    Art: { bg: "bg-category-arts-bg", text: "text-category-arts-text" },
    Dance: { bg: "bg-category-arts-bg", text: "text-category-arts-text" },
    Design: { bg: "bg-category-arts-bg", text: "text-category-arts-text" },
    Culture: { bg: "bg-category-cultural-bg", text: "text-category-cultural-text" },
    Religion: { bg: "bg-category-religious-bg", text: "text-category-religious-text" },
    Advocacy: DEFAULT_CATEGORY_STYLE,
    Technology: { bg: "bg-category-technology-bg", text: "text-category-technology-text" },
    Entrepreneurship: { bg: "bg-category-entrepreneurship-bg", text: "text-category-entrepreneurship-text" },
    Health: { bg: "bg-category-health-bg", text: "text-category-health-text" },
    Wellness: { bg: "bg-category-health-bg", text: "text-category-health-text" },
    "Mental Health": { bg: "bg-category-health-bg", text: "text-category-health-text" },
    Music: { bg: "bg-category-music-bg", text: "text-category-music-text" },
    Food: DEFAULT_CATEGORY_STYLE,
    Volunteering: DEFAULT_CATEGORY_STYLE,
    Events: { bg: "bg-category-events-bg", text: "text-category-events-text" },
    Clubs: { bg: "bg-category-clubs-bg", text: "text-category-clubs-text" },
    Academic: { bg: "bg-category-academic-bg", text: "text-category-academic-text" },
    Religious: { bg: "bg-category-religious-bg", text: "text-category-religious-text" },
    Cultural: { bg: "bg-category-cultural-bg", text: "text-category-cultural-text" },
    "Social & Games": { bg: "bg-category-social-bg", text: "text-category-social-text" },
    "Sports & Fitness": { bg: "bg-category-sports-bg", text: "text-category-sports-text" },
    "Career & Networking": { bg: "bg-category-career-bg", text: "text-category-career-text" },
    "Creative Arts": { bg: "bg-category-arts-bg", text: "text-category-arts-text" },
    "Arts & Crafts": { bg: "bg-category-arts-bg", text: "text-category-arts-text" },
    "Health & Wellness": { bg: "bg-category-health-bg", text: "text-category-health-text" },
    "Music & Performance": { bg: "bg-category-music-bg", text: "text-category-music-text" },
  };
  return mapping[category] || DEFAULT_CATEGORY_STYLE;
}
