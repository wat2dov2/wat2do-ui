/**
 * All localStorage / sessionStorage key strings used by the app.
 *
 * Single source of truth - prevents silent key drift and makes it easy
 * to audit what the app persists on the device.
 *
 * Allowed per AGENTS.md localStorage policy:
 *   theme, userEmail, userProfile, viewMode, filterViewMode,
 *   i18n-language, notificationPreferences, privacyPreferences,
 *   wat2do-app-prefs (composite of viewMode + filterViewMode via Zustand persist)
 */

export const STORAGE_KEYS = {
  // Auth (cache only - backend is source of truth)
  USER_EMAIL: "userEmail",
  USER_PROFILE: "userProfile",

  // Appearance / device preferences
  THEME: "theme",
  LANGUAGE: "i18n-language",

  // Settings
  NOTIFICATION_PREFS: "notificationPreferences",
  PRIVACY_PREFS: "privacyPreferences",

  // Session (sessionStorage, not localStorage)
  SESSION_ID: "wat2do_session_id",
} as const;
