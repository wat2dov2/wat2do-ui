/**
 * Preferences Storage
 * Thin localStorage wrappers for device-level preferences (theme, language).
 * Lives in shared/ because these are consumed by shared infrastructure
 * (i18n, dark mode hook, theme toggler) - not feature-specific logic.
 */

import { StorageService } from "@/shared/services/storageService";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";
import {
  isSupportedLanguage,
  type SupportedLanguage,
} from "@/shared/constants/languages";

export type ThemePreference = "dark" | "light";

const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function loadTheme(): ThemePreference | null {
  const saved = StorageService.getItem<unknown>(STORAGE_KEYS.THEME, null);
  return saved === "dark" || saved === "light" ? saved : null;
}

export function saveTheme(theme: ThemePreference): void {
  StorageService.setItem(STORAGE_KEYS.THEME, theme);

  if (typeof window === "undefined") return;

  const cookieAttributes = [
    `${STORAGE_KEYS.THEME}=${encodeURIComponent(theme)}`,
    "path=/",
    `max-age=${THEME_COOKIE_MAX_AGE_SECONDS}`,
    "samesite=lax",
  ];
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "wat2do.io" || hostname.endsWith(".wat2do.io")) {
    cookieAttributes.push("domain=.wat2do.io", "secure");
  }
  document.cookie = cookieAttributes.join("; ");
}

// ── Language ────────────────────────────────────────────────────────

export function loadLanguage(): SupportedLanguage {
  const saved = StorageService.getItem<string | null>(STORAGE_KEYS.LANGUAGE, null);
  if (saved && isSupportedLanguage(saved)) {
    return saved;
  }
  return 'en';
}

export function saveLanguage(language: SupportedLanguage): void {
  StorageService.setItem(STORAGE_KEYS.LANGUAGE, language);
}
