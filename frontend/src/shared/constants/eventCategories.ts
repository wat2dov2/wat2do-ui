/**
 * Event categories — the static union and list used by filters, forms, etc.
 */

/** Static list of event categories, used by filters/forms. */
export const EVENT_CATEGORIES = [
  "Academics", "Studying", "Career", "Networking", "Games",
  "Partying", "Athletics", "Art", "Dance", "Culture",
  "Religion", "Advocacy", "Technology", "Design", "Entrepreneurship",
  "Health", "Wellness", "Mental Health", "Music", "Sports",
  "Food", "Volunteering",
] as const;

/** Union type of all valid event categories. */
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/**
 * Default category used as a fallback when an event has no explicit category.
 * Used across event creation, display, and data transformation.
 */
export const DEFAULT_EVENT_CATEGORY = "Events";
