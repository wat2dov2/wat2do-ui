/**
 * All localStorage / sessionStorage key strings used by the app.
 *
 * Single source of truth - prevents silent key drift and makes it easy
 * to audit what the app persists on the device.
 *
 * Allowed per AGENTS.md localStorage policy:
 *   theme, userEmail, userProfile, viewMode,
 *   i18n-language,
 *   wat2do-app-prefs (viewMode via Zustand persist)
 */

export const STORAGE_KEYS = {
  // Auth (cache only - backend is source of truth)
  USER_EMAIL: "userEmail",
  USER_PROFILE: "userProfile",

  // Appearance / device preferences
  THEME: "theme",
  LANGUAGE: "i18n-language",

  // Session (sessionStorage, not localStorage)
  SESSION_ID: "wat2do_session_id",
  POSTER_SCAN_CONFIRMATION: "wat2do:poster-scan-confirmation",
} as const;
