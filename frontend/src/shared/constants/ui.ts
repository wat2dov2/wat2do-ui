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

/** Font size (px) for Monaco JSON editors across the app. */
export const JSON_EDITOR_FONT_SIZE = 12;


/** Small delay (ms) to allow DOM updates before scrolling to an element. */
export const SCROLL_INTO_VIEW_DELAY_MS = 100;


/** Height of the scan-locations map on the posters page. Used by admin and club-panel. */
export const POSTER_MAP_HEIGHT = "600px";
