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

/**
 * Sanitize an HTML string to allow only safe inline formatting tags.
 *
 * Strips every HTML tag except `<strong>`, `</strong>`, `<em>`, and `</em>`.
 * The sanitizer rejects any attributes on allowed tags (so `<strong onclick>` is
 * stripped), tolerates extra whitespace (`<strong >`), and is immune to nul-byte
 * placeholder forgery: nul bytes are removed from input up front.
 *
 * Prefer `renderTranslatedRichText` over feeding the output into
 * `dangerouslySetInnerHTML`; this helper is exported only for tests.
 */
export function sanitizeTranslationHTML(html: string): string {
  // Drop nul bytes so an attacker cannot inject placeholder tokens that the
  // old regex-based approach used internally.
  const cleaned = html.replace(/\x00/g, "");
  // Match any tag-like token `<...>`. Only replace with the canonical form when
  // the token is exactly one of our allowed tags (ignoring case and surrounding
  // whitespace, and rejecting attributes). All other tag-like tokens are stripped.
  // Anything that doesn't look like a tag (e.g. "a < b") is left untouched.
  return cleaned.replace(/<[^>]*>/g, (match) => {
    const inner = match.slice(1, -1).trim();
    const lower = inner.toLowerCase();
    if (lower === "strong") return "<strong>";
    if (lower === "/strong") return "</strong>";
    if (lower === "em") return "<em>";
    if (lower === "/em") return "</em>";
    return "";
  });
}
