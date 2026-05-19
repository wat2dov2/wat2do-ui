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
    Clubs: categoryStyle("bg-category-clubs-bg", "text-category-clubs-text", "border-category-clubs-text/25"),
    Academic: academic,
    Religious: religious,
    Cultural: cultural,
    "Social & Games": social,
    "Sports & Fitness": sports,
    "Career & Networking": career,
    "Creative Arts": arts,
    "Arts & Crafts": arts,
    "Health & Wellness": health,
    "Music & Performance": music,
  };
  return mapping[category] || DEFAULT_CATEGORY_STYLE;
}
