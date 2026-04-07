/**
 * Event categories — derived from the backend via /meta/constants.
 *
 * `getEventCategories()` returns the live list fetched at app init.
 * `EVENT_CATEGORIES` and `EventCategory` are kept for backwards compat
 * with existing consumers that import them statically (filters, forms, etc.).
 *
 * The static array is only a compile-time type hint + fallback;
 * runtime code should prefer `getEventCategories()`.
 */

import { getAppConstants } from "@/shared/api/metaApi";

// Static list kept for the EventCategory union type and as a fallback.
const _STATIC_CATEGORIES = [
  "Academics", "Studying", "Career", "Networking", "Games",
  "Partying", "Athletics", "Art", "Dance", "Culture",
  "Religion", "Advocacy", "Technology", "Design", "Entrepreneurship",
  "Health", "Wellness", "Mental Health", "Music", "Sports",
  "Food", "Volunteering",
] as const;

/** Union type of all valid event categories. */
export type EventCategory = (typeof _STATIC_CATEGORIES)[number];

/**
 * Runtime list of event categories from the backend.
 * Falls back to the static list if the fetch hasn't completed.
 */
export function getEventCategories(): string[] {
  return getAppConstants().event_categories;
}

/**
 * Static export for existing consumers.
 * Prefer `getEventCategories()` in new code.
 */
export const EVENT_CATEGORIES = _STATIC_CATEGORIES;
