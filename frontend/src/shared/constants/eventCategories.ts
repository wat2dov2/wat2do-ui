/**
 * Event categories — the static union and list used by filters, forms, etc.
 *
 * The single source of fallback data lives in metaApi.ts (FALLBACK_EVENT_CATEGORIES);
 * this module re-exports from there — no duplicate list here.
 */

import { FALLBACK_EVENT_CATEGORIES } from "@/shared/api/metaApi";

/** Union type of all valid event categories. */
export type EventCategory = (typeof FALLBACK_EVENT_CATEGORIES)[number];

/** Static list of event categories, used by filters/forms. */
export const EVENT_CATEGORIES = FALLBACK_EVENT_CATEGORIES;

/**
 * Default category used as a fallback when an event has no explicit category.
 * Used across event creation, display, and data transformation.
 */
export const DEFAULT_EVENT_CATEGORY = "Events";
