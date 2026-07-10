/**
 * Shared UI constants used across multiple features.
 *
 * Only values referenced by 2+ features belong here.
 * Feature-local constants live in their own feature directory.
 */

/**
 * Standard image-area height (px) for full-size event cards
 * (EventCard, EventFormPreview, EventCardSkeleton).
 */
export const EVENT_CARD_IMAGE_HEIGHT = 176;

/** Standard responsive grid for event and organization card lists. */
export const CARD_GRID_CLASS =
  "grid grid-cols-2 gap-2 sm:gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

/** Font size (px) for Monaco JSON editors across the app. */
export const JSON_EDITOR_FONT_SIZE = 12;

/** Debounce window (ms) before parsing JSON editor input into app state. */
export const JSON_EDITOR_DEBOUNCE_MS = 300;


/** Small delay (ms) to allow DOM updates before scrolling to an element. */
export const SCROLL_INTO_VIEW_DELAY_MS = 100;


/** Height of the scan-locations map on the posters page. Used by admin and organization-panel. */
export const POSTER_MAP_HEIGHT = "600px";
