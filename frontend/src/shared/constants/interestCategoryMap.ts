/**
 * Maps user profile interests to event categories.
 *
 * `getInterestToCategoriesMap()` returns the live mapping fetched
 * from the backend at app init via /meta/constants.
 *
 * The static `INTEREST_TO_CATEGORIES` is kept for backwards compat.
 */

import { getAppConstants } from "@/shared/api/metaApi";

/**
 * Runtime mapping from the backend.
 * Falls back to compiled defaults if the fetch hasn't completed.
 */
export function getInterestToCategoriesMap(): Record<string, string[]> {
  return getAppConstants().interest_to_categories;
}

/**
 * Static export for existing consumers.
 * Prefer `getInterestToCategoriesMap()` in new code.
 */
export const INTEREST_TO_CATEGORIES: Record<string, string[]> = {
  Academic: ["Academics", "Studying"],
  Social: ["Partying", "Games", "Dance"],
  Career: ["Career", "Networking", "Entrepreneurship"],
  Sports: ["Athletics", "Sports"],
  Music: ["Music"],
  Art: ["Art", "Design"],
  Technology: ["Technology"],
  Gaming: ["Games"],
  Food: ["Food"],
  Networking: ["Networking", "Career"],
  Health: ["Health", "Wellness", "Mental Health"],
  Cultural: ["Culture", "Religion", "Advocacy"],
};

/**
 * Given a list of user interests, return the set of matching event categories.
 * Uses the backend-fetched mapping at runtime.
 */
export function interestsToCategories(interests: string[]): Set<string> {
  const map = getInterestToCategoriesMap();
  const categories = new Set<string>();
  for (const interest of interests) {
    const mapped = map[interest];
    if (mapped) {
      for (const cat of mapped) {
        categories.add(cat);
      }
    }
  }
  return categories;
}
