/**
 * Preferences Storage
 * Thin localStorage wrappers for device-level preferences (theme, language).
 * Lives in shared/ because these are consumed by shared infrastructure
 * (i18n, dark mode hook, theme toggler) — not feature-specific logic.
 */

import { StorageService } from "@/shared/services/storageService";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";

// ── Theme ───────────────────────────────────────────────────────────

export function loadTheme(): "dark" | "light" | null {
  const saved = StorageService.getItem<string | null>(STORAGE_KEYS.THEME, null);
  return saved === "dark" || saved === "light" ? saved : null;
}

export function saveTheme(theme: "dark" | "light"): void {
  StorageService.setItem(STORAGE_KEYS.THEME, theme);
}

// ── Language ────────────────────────────────────────────────────────

const SUPPORTED_LANGUAGES = ['en'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export function loadLanguage(): SupportedLanguage {
  const saved = StorageService.getItem<string | null>(STORAGE_KEYS.LANGUAGE, null);
  if (saved && SUPPORTED_LANGUAGES.includes(saved as SupportedLanguage)) {
    return saved as SupportedLanguage;
  }
  return 'en';
}

export function saveLanguage(language: SupportedLanguage): void {
  StorageService.setItem(STORAGE_KEYS.LANGUAGE, language);
}
