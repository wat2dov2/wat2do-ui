import { StorageService } from "@/shared/services/storageService";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";
import {
  isSupportedLanguage,
  type SupportedLanguage,
} from "@/shared/constants/languages";

type ThemePreference = "dark" | "light";

const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

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

export function loadLanguage(defaultLanguage: SupportedLanguage = 'en'): SupportedLanguage {
  const saved = StorageService.getItem<string | null>(STORAGE_KEYS.LANGUAGE, null);
  if (saved && isSupportedLanguage(saved)) {
    return saved;
  }
  return defaultLanguage;
}

export function saveLanguage(language: SupportedLanguage): void {
  StorageService.setItem(STORAGE_KEYS.LANGUAGE, language);
}
