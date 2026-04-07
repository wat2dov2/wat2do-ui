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
export function toFacultyKey(faculty: string): string {
  return faculty.toLowerCase().replace(/\s+/g, "");
}

/**
 * Strip characters that are not valid in an email username (local part).
 * Keeps alphanumeric characters, dots, underscores, and hyphens.
 *
 * Example: "john doe!@#" -> "johndoe"
 */
export function sanitizeEmailUsername(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

/**
 * Remove a trailing slash from a URL or path string.
 *
 * Example: "https://example.com/" -> "https://example.com"
 */
export function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}
