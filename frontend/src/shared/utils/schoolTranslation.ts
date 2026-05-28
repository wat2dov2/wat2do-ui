
/**
 * School Translation Map
 * Maps canonical school names to translation key suffixes.
 */
const SCHOOL_TO_KEY: Record<string, string> = {
  "University of Waterloo": "uwaterloo",
  "University of Toronto": "utoronto",
  "McGill University": "mcgill",
  "University of British Columbia": "ubc",
  "McMaster University": "mcmaster",
};

/**
 * Maps a canonical school name to its full translation key.
 * If the school is not in the list, returns the school name itself.
 */
export function toSchoolTranslationKey(school: string): string {
  const key = SCHOOL_TO_KEY[school];
  return key ? `schools.list.${key}` : school;
}

/**
 * Translates a canonical school name using the translation function `t`.
 * Falls back to the canonical school name if no key is found or if translation fails.
 */
export function translateSchool(school: string, t: (key: string) => string): string {
  if (!school) return school;
  const key = toSchoolTranslationKey(school);
  if (key.startsWith("schools.list.")) {
    const translated = t(key);
    return translated !== key ? translated : school;
  }
  return school;
}
