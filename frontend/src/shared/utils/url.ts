/**
 * URL validation utilities.
 *
 * Provides safe URL validation to prevent open-redirect and XSS attacks
 * via javascript:, data:, blob:, vbscript:, or file: protocol URLs.
 */

/** Protocols that are safe for browser navigation. */
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Check whether a URL string is safe for browser navigation.
 *
 * A URL is considered safe when:
 * 1. It is well-formed (parseable by `new URL()`).
 * 2. Its protocol is http: or https:.
 *
 * Returns `true` for safe URLs, `false` for anything else (including
 * javascript:, data:, blob:, vbscript:, file:, or malformed strings).
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Return the URL unchanged if it is safe for navigation, or a fallback path
 * (defaults to "/") if it is not.
 *
 * Use this before any `window.location.href = url` assignment where the URL
 * originates from user-controlled or backend-provided data.
 */
export function sanitizeRedirectUrl(url: string, fallback = "/"): string {
  return isSafeUrl(url) ? url : fallback;
}

/**
 * Return the URL if it uses a safe protocol (http/https), or an empty string
 * otherwise.  An empty-string href renders an inert `<a>` tag.
 *
 * Use this for any `<a href={...}>` or `window.open(...)` where the URL
 * comes from user-controlled or backend-provided data (e.g. club.discord,
 * club.club_page, event.source_url).
 *
 * Handles null/undefined (returns ""), and strips leading/trailing whitespace
 * before validation to defeat whitespace-padding tricks.
 */
export function sanitizeHref(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  return isSafeUrl(trimmed) ? trimmed : "";
}
