/**
 * Event categories — derived from the backend via /meta/constants.
 *
 * `getEventCategories()` returns the live list fetched at app init.
 * `EVENT_CATEGORIES` and `EventCategory` are kept for backwards compat
 * with existing consumers that import them statically (filters, forms, etc.).
 *
 * The single source of fallback data lives in metaApi.ts (FALLBACK);
 * this module re-exports from there — no duplicate list here.
 */

import { getAppConstants, FALLBACK_EVENT_CATEGORIES } from "@/shared/api/metaApi";

/** Union type of all valid event categories. */
export type EventCategory = (typeof FALLBACK_EVENT_CATEGORIES)[number];

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
export const EVENT_CATEGORIES = FALLBACK_EVENT_CATEGORIES;

/**
 * Default category used as a fallback when an event has no explicit category.
 * Used across event creation, display, and data transformation.
 */
export const DEFAULT_EVENT_CATEGORY = "Events";
