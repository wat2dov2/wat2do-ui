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

/**
 * Sanitize an HTML string to allow only safe inline formatting tags.
 *
 * Strips every HTML tag except `<strong>`, `</strong>`, `<em>`, and `</em>`.
 * Use this whenever translation strings are rendered via dangerouslySetInnerHTML
 * as defense-in-depth against stored XSS if translation sources are ever
 * compromised.
 */
export function sanitizeTranslationHTML(html: string): string {
  // Replace allowed tags with unique placeholders, strip all remaining tags,
  // then restore the placeholders.
  const ALLOWED: [RegExp, string, string][] = [
    [/<strong>/gi, "\x00STRONG_OPEN\x00", "<strong>"],
    [/<\/strong>/gi, "\x00STRONG_CLOSE\x00", "</strong>"],
    [/<em>/gi, "\x00EM_OPEN\x00", "<em>"],
    [/<\/em>/gi, "\x00EM_CLOSE\x00", "</em>"],
  ];

  let safe = html;
  for (const [re, placeholder] of ALLOWED) {
    safe = safe.replace(re, placeholder);
  }
  // Strip all remaining HTML tags
  safe = safe.replace(/<[^>]*>/g, "");
  // Restore allowed tags
  for (const [, placeholder, tag] of ALLOWED) {
    safe = safe.split(placeholder).join(tag);
  }
  return safe;
}
