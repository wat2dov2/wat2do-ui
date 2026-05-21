/**
 * Pagination constants shared across features.
 *
 * Keep in sync with backend:
 * - DEFAULT_RECOMMENDATION_LIMIT → services/recommender/config.py DEFAULT_LIMIT
 * - ADMIN_ITEMS_PER_PAGE → admin UI page size (events, clubs)
 * - ADMIN_POSTERS_PER_PAGE → admin posters page size (dense split-panel layout)
 */

/** Must match backend DEFAULT_LIMIT in services/recommender/config.py */
export const DEFAULT_RECOMMENDATION_LIMIT = 20;

/** Page size for all admin data tables (events, clubs). */
export const ADMIN_ITEMS_PER_PAGE = 20;

/** Page size for admin posters table (smaller due to dense split-panel layout). */
export const ADMIN_POSTERS_PER_PAGE = 10;
