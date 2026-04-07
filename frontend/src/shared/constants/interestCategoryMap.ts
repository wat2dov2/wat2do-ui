/**
 * Maps user profile interests (12 values) to event categories (22 values).
 * Must stay in sync with backend/constants.py INTEREST_TO_CATEGORIES.
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
 */
export function interestsToCategories(interests: string[]): Set<string> {
  const categories = new Set<string>();
  for (const interest of interests) {
    const mapped = INTEREST_TO_CATEGORIES[interest];
    if (mapped) {
      for (const cat of mapped) {
        categories.add(cat);
      }
    }
  }
  return categories;
}
