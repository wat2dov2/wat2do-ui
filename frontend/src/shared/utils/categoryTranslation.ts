/** Translate canonical organization category labels via locale keys. */
export function getClubCategoryTranslation(
  category: string,
  t: (key: string) => string,
): string {
  const clubKey = `organizations.categories.${category}`;
  const translatedClub = t(clubKey);
  return translatedClub !== clubKey ? translatedClub : category;
}
