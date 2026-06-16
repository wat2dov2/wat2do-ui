/**
 * Shared string manipulation utilities.
 *
 * Centralizes regex/normalization patterns that were previously duplicated
 * across multiple features.
 */

/**
 * Normalize a faculty name into a lowercase key with no whitespace.
 *
 * Example: "Applied Health Sciences" -> "appliedhealthsciences"
 */
function toFacultyKey(faculty: string): string {
  return faculty.toLowerCase().replace(/\s+/g, "");
}

/**
 * Build the i18n translation key for a faculty name.
 *
 * Handles the special case where "Applied Health Sciences" maps to
 * `onboarding.faculties.appliedHealthSciences` (camelCase) while all
 * other faculties use their simple lowercase key.
 */
export function toFacultyTranslationKey(faculty: string): string {
  const key = toFacultyKey(faculty);
  const translationSuffix = key === "appliedhealthsciences" ? "appliedHealthSciences" : key;
  return `onboarding.faculties.${translationSuffix}`;
}

/**
 * Remove a trailing slash from a URL or path string.
 *
 * Example: "https://example.com/" -> "https://example.com"
 */
export function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

