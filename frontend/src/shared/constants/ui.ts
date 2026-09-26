/**
 * Shared UI constants used across multiple features.
 *
 * Only values referenced by 2+ features belong here.
 * Feature-local constants live in their own feature directory.
 */

/**
 * Standard image-area height (px) for full-size browse cards
 * (event and position cards plus their previews and skeletons).
 */
export const EVENT_CARD_IMAGE_HEIGHT = 208;

/** Standard responsive grid for event, position, and club card lists. */
export const CARD_GRID_CLASS =
  "grid grid-cols-2 gap-x-4 gap-y-2 sm:gap-x-5 sm:gap-y-2.5 min-[480px]:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]";

/** Match the two mobile columns and the auto-filled desktop card tracks. */
export const CARD_GRID_IMAGE_SIZES = "(max-width: 479px) 50vw, 320px";


/** Small delay (ms) to allow DOM updates before scrolling to an element. */
export const SCROLL_INTO_VIEW_DELAY_MS = 100;

/** AppLayout main content scroller used by BackToTopButton and scroll helpers. */
export const MAIN_CONTENT_SCROLL_ROOT_SELECTOR = ".main-content-grid";

/** The page's search input, focused by the "/" hotkey and the command palette. */
export const SEARCH_INPUT_SELECTOR = "[data-search-input]";


/** Height of the scan-locations map on the posters page. Used by admin and club-panel. */
export const POSTER_MAP_HEIGHT = "600px";
