/**
 * Normalize club category keys to the shared event-category translation
 * keys where they overlap (Academic, Religious, Cultural), falling back
 * to `clubs.categories.*` for WUSA-specific categories.
 */

const CATEGORY_TO_SHARED_KEY: Record<string, string> = {
  Academic: "categories.academic",
  Religious: "categories.religious",
  Cultural: "categories.cultural",
};

export function getClubCategoryTranslation(
  category: string,
  t: (key: string) => string,
): string {
  const sharedKey = CATEGORY_TO_SHARED_KEY[category];
  if (sharedKey) {
    const translated = t(sharedKey);
    return translated !== sharedKey ? translated : category;
  }
  const clubKey = `clubs.categories.${category}`;
  const translatedClub = t(clubKey);
  return translatedClub !== clubKey ? translatedClub : category;
}
